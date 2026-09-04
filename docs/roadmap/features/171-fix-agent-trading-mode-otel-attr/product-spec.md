# Product Spec: fix-agent-trading-mode-otel-attr

**Type**: bug
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (item 1)
**Severity**: SEV-3
**Created**: 2026-09-04

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

- `xstockstrat-agent` (`app/telemetry.py`) — single service.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] **Open decision (design gate)**: drop the `trading_mode` resource attribute entirely, OR rename
      it (e.g. `deployment.trading_mode`) to make its meaning explicit and post-147-consistent. If any
      Grafana dashboard/alert queries `trading_mode`, dropping it is a breaking observability change —
      confirm no dashboard depends on it before removing.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario that must fail on the current attribute shape and
pass after the decided fix (Constitution **C-15**). Plus: agent starts cleanly with `OTEL_ENABLED`
true and false; existing agent tests pass.

## Out of Scope

- Changing the paper/live routing semantics of `TRADING_MODE` itself (a live axis for trading).
- Telemetry attributes on any other service.
