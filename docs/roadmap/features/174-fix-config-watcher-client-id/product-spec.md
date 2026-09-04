# Product Spec: fix-config-watcher-client-id

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 4)
**Severity**: SEV-3
**Created**: 2026-09-04

---

## Problem Statement

**Observed**: two Python config watchers send a `client_id` that names the wrong service, copied from
the indicators template:

- `services/xstockstrat-analysis/app/config/watcher.py:61` — `client_id=f"indicators-{id(self)}"`
- `services/xstockstrat-ingest/app/config/watcher.py:73` — `client_id=f"indicators-{id(self)}"`

(The indicators watcher itself is correct: `watcher.py:60` `client_id=f"indicators-{id(self)}"`.)

So the analysis and ingest subscribers both identify to `xstockstrat-config` as `indicators-…` on
their `WatchConfig` streams.

**Expected**: each subscriber should identify with its own service name (`analysis-…` / `ingest-…`)
— **unless** `client_id` is a pure diagnostic label the config service never keys on, in which case
the current value is cosmetically wrong but behaviorally harmless.

## Reproduction Steps

1. Start `xstockstrat-analysis` and `xstockstrat-ingest` with `OTEL`/config wiring against
   `xstockstrat-config`.
2. Inspect the `WatchConfigRequest.client_id` values the config service receives (server logs / any
   per-subscriber bookkeeping).
3. Observe both arriving as `indicators-<objid>`.

## Root Cause Hypothesis

Copy-paste from the indicators watcher template when the analysis and ingest watchers were created;
the `client_id` prefix was never localized to the new service name.

## Affected Services

- `xstockstrat-analysis` (`app/config/watcher.py`)
- `xstockstrat-ingest` (`app/config/watcher.py`)
- `xstockstrat-config` — **investigation dependency only**: whether it keys on `client_id` for
  subscriber identification / dedup / fan-out decides whether this is a real defect or cosmetic.

## Functional Requirements

- **FR-1** — The `xstockstrat-analysis` and `xstockstrat-ingest` config watchers each construct their
  `WatchConfig` request with a `client_id` prefixed by **their own** service name (`analysis-…` /
  `ingest-…`), not the copy-pasted `indicators-…`. (The indicators watcher's own correct `client_id`
  is unchanged.) Whether the shared prefix was behaviorally significant to `xstockstrat-config` or
  merely a diagnostic label is an investigation question for design/spec, but FR-1 — correct
  per-service identification — holds either way.

## Consumer Surface(s)

**None — internal/platform-only.** `client_id` is a field on the internal `WatchConfigRequest` gRPC
message between a backend service and `xstockstrat-config`; it is a subscriber identifier / diagnostic
label with no `xstockstrat-ui` segment or Agent MCP tool surface. No consumer-surface step required.
(**C-14**)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] **Open question (design/spec gate)**: determine whether `xstockstrat-config` uses `client_id`
      for subscriber identification, dedup, or per-client fan-out.
      - If **significant**: the shared `indicators-` prefix is a genuine collision defect — correct
        each watcher to its own prefix and add the regression guard.
      - If **cosmetic**: correct the prefix per service for correctness/observability hygiene; no
        behavioral change, lower priority.

## Acceptance Criteria

See `acceptance.feature` — each service's `WatchConfig` request carries a `client_id` prefixed with
its own service name (test fails on the current `indicators-` value in analysis/ingest, passes after
the correction). Plus: existing analysis + ingest tests pass; config subscription still establishes
on both services.

## Out of Scope

- The indicators watcher's (correct) `client_id`.
- Any change to how `xstockstrat-config` assigns or uses `client_id`, beyond confirming its
  significance for the routing decision above.
