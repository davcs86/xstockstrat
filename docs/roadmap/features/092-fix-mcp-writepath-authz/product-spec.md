# Product Spec: fix-mcp-writepath-authz

**Type**: bug
**Source Report**: `docs/reports/2026-08-01-mcp-tools-alignment-triage.md` (F-11)
**Severity**: SEV-2
**Created**: 2026-08-02

---

## Problem Statement

Authorization on write paths is asymmetric where it matters most (report F-11):

- Ingest gates `CancelBackfill` on admin but **not `TriggerBackfill`** — the operation that spends
  provider quota is the ungated one.
- Notify's `EmitAlert` is fully ungated.
- The agent's management tools forward a **hardcoded** admin `x-access-scope=7` that nothing verifies
  (except `set_config`, which since feature 073 forwards the caller's real derived scope). So
  `trigger_backfill`'s "admin-scoped write" label is decorative.

Expected: `TriggerBackfill` is gated server-side like `CancelBackfill`; a deliberate decision on
`EmitAlert` gating; and the feature-073 caller-derived-scope pattern extended to the remaining write
tools so admin is verified, not asserted.

## Reproduction Steps

1. A non-admin caller (or any caller) invokes `trigger_backfill` → ingest queues a paid backfill;
   the `x-access-scope` is transported but never checked.
2. `emit_alert` from any caller → notify stores/fans out with no role check.

## Root Cause Hypothesis

Two independent layers (agent asserts identity; services enforce it) that don't line up; the
quota-spending RPC sits in the gap. See report F-11 (RC — authz asymmetry).

## Affected Services

`xstockstrat-ingest` (`app/handlers/servicer.py` `TriggerBackfill` gate, mirroring `CancelBackfill`),
`xstockstrat-notify` (`src/grpc/notifyServiceImpl.ts` `emitAlert` gating decision),
`xstockstrat-agent` (`app/client.py` write tools → caller-derived scope like `set_config`;
`app/tools.py` add `ctx` where missing), plus invariant docs (AGENT-3/AGENT-4).

## Fix Scope

- [ ] No proto changes anticipated (scope already travels in metadata).
- [ ] No database migrations anticipated.
- [ ] No config key changes anticipated.
- **Sequencing is load-bearing:** land backend gates FIRST; only then flip the agent from the
  hardcoded scope to caller-derived — otherwise a legitimate admin is denied, or a gate-less backend
  starts trusting an unverified header.
- Update `services/xstockstrat-agent/docs/context-constitution.md` AGENT-3/AGENT-4 and the CLAUDE.md
  § Management-tool authorization when the "one documented exception" (`set_config`) generalizes.

## Acceptance Criteria

- [ ] `TriggerBackfill` returns `PERMISSION_DENIED` without the admin bit (RED: currently proceeds);
      admin still gets a `QUEUED` job.
- [ ] `EmitAlert` gating decision implemented (gate, or an explicit service-caller contract) with a test.
- [ ] Management write tools forward the caller's derived scope; a non-admin is rejected by the
      backend gate rather than silently succeeding under scope=7.
- [ ] AGENT-3/AGENT-4 invariant docs updated to match.

## Out of Scope

- `cancel_backfill` tool addition itself (feature 087) — this feature only concerns the gating model.
