# Context: otel-metrics-logs-export

**Feature**: `docs/roadmap/features/274-otel-metrics-logs-export/feature.md`
**Product Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/274-otel-metrics-logs-export/implementation-spec.md`

---

## Session 2026-10-21 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Source: root `docs/context-constitution-findings.md` row "metrics and logs" (Remedy: "New capability →
  `/sdd-story` to add metrics/logs export") and report
  `docs/reports/2026-10-19-otel-metrics-logs-never-exported-defect.md`.
- Operator decisions (binding, recorded 2026-10-21, answered in-session):
  - **NNN = 274, operator-specified.** max+1 was 254 (highest on main-dev and all `feature/*` branches: 253). This
    deviates from `feature-workflow.md` § Feature Numbering by explicit operator instruction; 254–273 are unused.
  - **Ordering vs feature 250: "250 lands first, 274 after".** 250 (`fix-otel-metrics-logs-gap`,
    implementation-ready, operator decision "Narrow to traces") ships as specced and removes the metric/log-backed
    alerts and panels; 274 then adds export and restores them (FR-6). Recorded as a hard row in `merge-order.md`.
    The design must build on 250's landed state, including its produced-signals guard.
  - **This feature reverses feature 226 Operator Decision 3 (traces only)** for metrics/logs. The operator
    requested it explicitly (C-11 sign-off for a new capability).
  - **Logs path: in-process OTLP log bridge** (Go slog, Python logging, Node winston → LoggerProvider → OTLP/HTTP
    `/v1/logs`); DO `log_destinations` / collector filelog rejected.
  - **`platform.otel.enabled` live switch: not implemented; fix the docs.** Out of 274's scope. The phantom claim
    in `docs/patterns/observability.md` was removed and its root findings row marked resolved in the same docs-only
    change that filed this story (outside SDD, per root CLAUDE.md: docs-only edits are out of the entry-point rule).
- Open forks deferred to `/sdd-design` (see product-spec Open Questions): FR-2 series-name parity across
  languages, cardinality budget, and whether 250's `trace-derived-alerting` follow-up should cite 274 instead.

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Pass 1: FAIL on criterion 9 (7 unchecked Open Questions), plus warnings: FR-2/AC-2 series-name conflict (C-15),
  thin AC coverage of FR-1/3/4/5/6 (C-15), AC-3 log text not in code, deployment env parity (C-1).
  Fixed: series name is the contract (a rename needs operator sign-off and a superseding AC); design forks moved to
  "Deferred to /sdd-design", ledger traps to "Known Traps"; AC-3 rebased on the real line
  `servicer.py:799-800` ("running backtest id=…"); added AC-10..AC-14; env parity stated in FR-1.
- Finding carried to design: the pre-250 scoring-stall regex `ScoreStrategy|RunBacktest` matches no line analysis
  emits, so FR-6 must re-derive that rule (recorded in FR-3).
- Pass 2: PASS WITH WARNINGS (5), all fixed: stale Out-of-Scope pointer; AC-6 made concrete (≤1 s startup delta);
  AC-9 extended to PLAT-3, OTEL-1/OTEL-2, packages/otel docs + findings; AC-1/AC-10 marked representative;
  `OTEL_ENABLED` per target stated (dev "true", prod "false", compose off) and the prod flip scoped out as a separate
  operator rollout step after the cost budget (default chosen by reviewer-fix; operator may override).
- Warnings remaining: none.
- Overlap findings (no FAIL): file-level with 250 on `packages/otel/alerts/*`, dashboards, the produced-signals
  guard and the FR-7 docs (covered by the existing `merge-order.md` row); rebase-only WARN with 252 on identity
  `src/__tests__/telemetry*.test.ts`; soft env-file overlap with 084/242; semantic coupling with 245 (relies on
  `xstk-error-rate-high`); 250's `trace-derived-alerting` placeholder is a possible duplicate (deferred to design).
- Tooling drift noticed (not fixed here, out of scope): `.claude/skills/sdd-review/reference/overlap-check.md:12-13`
  greps `feature.md` for status, but status lives only in `status.md`.

## Session 2026-10-21 — sdd-design (Phase 0 checkpoint)

- Mode: full debate. Operator steer: "using 250 as base design" — design builds on 250's landed end state.
- Phase 0 Recon written (`recon.md`). Pinned-SDK probe: Go otelgrpc v0.52 emits `rpc.server.duration` (ms);
  Python instrumentation-grpc 0.63b1 and Node instrumentation-grpc 0.52.1 emit **no** RPC metric (R1).
- Top risks carried into grilling: R1 (7/10 backends need a custom recorder), R2 (Grafana `service_name` label
  promotion unproven), R3 (scoring-stall rule must be re-derived), R10 (250 guard has no produced-path mechanism),
  R11 (250's `trace-derived-alerting` follow-up).
