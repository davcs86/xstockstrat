# Context: trading-crash-consistency

**Feature**: `docs/roadmap/features/105-trading-crash-consistency/feature.md`
**Product Spec**: `docs/roadmap/features/105-trading-crash-consistency/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/105-trading-crash-consistency/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P1 item 8 ("crash-consistency test suite").
- Hard-depends on 103 (broker-failure-simulator) and 101 (exactly-once-order-intent — the durable
  intent model this suite proves survives a crash).

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- Feasibility re-check found CI has no ephemeral-Postgres/service-container setup at all (see 103's
  context.md) — this suite is new CI infrastructure investment for a solo-maintained project, not an
  incremental addition. The crash scenario it targets (mid-automated-order-lifecycle) is real on this
  infra (single `instance_count: 1` per service, no HA — a redeploy genuinely can interrupt an
  in-flight request), but that risk applies equally to a **human-placed** order today, which is a much
  narrower surface than the full lifecycle this suite was scoped to cover (place/replace/cancel/close/
  emergency-flatten, several of which have no real caller yet).
- Demoted to `demoted/canceled`, dependent on 101 and 103 (both demoted). The crash-safety concern for
  today's human-placed orders is better served by keeping 101's rescoped idempotent-intent model itself
  correct (see 101/context.md) than by building a dedicated crash-injection CI suite before there is
  more than one order-lifecycle caller to protect.
