# Product Spec: fix-agent-trading-mode-otel-attr

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 1)
**Severity**: SEV-3
**Created**: 2026-09-04
**Re-scoped**: 2026-09-04 (design gate) — **agent-only → fleet-wide**. Recon proved `trading_mode` is
not an agent-specific defect but a fleet-wide OTel resource attribute emitted identically by all 12
telemetry modules, redundant with `deployment.environment` 1:1 in both deploy targets and queried by
nothing. The user chose fleet-wide removal (the only internally-consistent fix) over agent-only
(creates divergence) or de-scope. See `recon.md` and `context.md`.

---

## Problem Statement

**Observed**: `services/xstockstrat-agent/app/telemetry.py` reads the `TRADING_MODE` env var
(line 33) and emits it as a `trading_mode` OpenTelemetry resource attribute (line 39):

```python
trading_mode = os.getenv("TRADING_MODE", "paper")
resource = Resource.create({
    "service.name": svc_name,
    "deployment.environment": environment,
    "trading_mode": trading_mode,
    "platform": "xstockstrat",
})
```

**Expected**: telemetry resource attributes should reflect the post-feature-147 model, where the
paper/live distinction is **derived from environment** (`production` = live, `staging` = paper) and
`trading_mode` is no longer a config/scope axis. A `trading_mode` resource attribute that mirrors a
retired axis is misleading in traces.

**Verification result (triage, 2026-09-04)**: `TRADING_MODE` **is** still a live env var — it is a
paper/live *routing* axis consumed by `xstockstrat-portfolio` (the `commonv1.TradingMode` enum) and
mapped by the indicators/ingest config watchers via `resolve_trading_mode()`. So the attribute is not
reading a dead variable; the defect is a **naming/semantics** mismatch with the post-147 model, not a
stale read. This is why the report flagged it "verify, not confirmed".

## Reproduction Steps

1. Run `xstockstrat-agent` with `OTEL_ENABLED=true` and `TRADING_MODE=paper` (or `live`).
2. Inspect the exported span resource attributes.
3. Observe a `trading_mode` attribute alongside `deployment.environment`, duplicating a distinction
   that feature 147 folded into `environment`.

## Root Cause Hypothesis

The `trading_mode` resource attribute predates feature 147's removal of the config/scope
`trading_mode` axis and was never reconciled. The agent's `deployment.environment` attribute already
carries the environment; whether a separate mode label is still wanted is the open question.

## Affected Services

The `trading_mode` OTel resource attribute is emitted identically by **all 12 telemetry modules**
(grep-confirmed 2026-09-04):
- **Go (3)** — `services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go`
- **Python (4)** — `services/xstockstrat-{agent,ingest,indicators,analysis}/app/telemetry.py`
- **Node (5)** — `services/xstockstrat-{ledger,identity,config,notify,ui}/src/telemetry.ts`
- **Docs** — `packages/otel/dashboards/README.md:40` (documents `trading_mode` as an expected attribute).

## Functional Requirements

- **FR-1** — The `trading_mode` resource attribute is **removed from every telemetry module** so the
  fleet's OTel `Resource` no longer carries the label redundant with `deployment.environment`. Each
  module's now-dead local `TRADING_MODE` env read (used only to populate the attribute) is removed with
  it. `deployment.environment` (from `APPLICATION_ENV`) continues to carry the environment. **The
  `TRADING_MODE` env var itself is NOT removed** — it remains a live paper/live routing axis for
  trading/portfolio/indicators/ingest (out of scope).
- **FR-2** — `packages/otel/dashboards/README.md` is updated to drop `trading_mode` from its documented
  resource-attribute list, so the docs match the emitted set.
- **FR-3** — A resource-attribute regression test (the first telemetry-attribute assertion on the
  platform) proves the built `Resource` no longer contains `trading_mode`, in at least one module per
  language (Go/Python/Node), and that telemetry init remains non-blocking.

## Consumer Surface(s)

**None — internal/platform-only.** `trading_mode` is an OpenTelemetry **resource attribute** surfaced
only in exported traces / Grafana dashboards — not through any `xstockstrat-ui` segment or Agent MCP
tool. Recon confirmed **no dashboard panel or alert rule queries it** (grep of `packages/otel/**`
returned only the README prose), so removal breaks no live query; the only doc consumer is the README
(FR-2). No end-user consumer-surface step required. (**C-14**)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [x] **Scope decided (design gate, user sign-off)**: **fleet-wide removal** of the `trading_mode`
      resource attribute across all 12 telemetry modules + the dashboards README. Chosen over agent-only
      (creates divergence) and de-scope (leaves a redundant label). Rationale in `recon.md` + `design.md`.
- [ ] Remove the attribute + its dead local `TRADING_MODE` read from each of the 12 modules; keep the
      `TRADING_MODE` env var (live routing axis) untouched.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario that must fail on the current attribute shape and
pass after the decided fix (Constitution **C-15**). Plus: agent starts cleanly with `OTEL_ENABLED`
true and false; existing agent tests pass.

## Out of Scope

- Removing or changing the `TRADING_MODE` **env var** itself, or the paper/live **routing** semantics
  it drives (portfolio/trading/indicators/ingest) — a live axis, untouched.
- Any telemetry attribute other than `trading_mode` (`service.name`, `deployment.environment`,
  `platform` stay).
- Renaming (rejected — the label is redundant, not mislabeled; removal is the honest fix).
