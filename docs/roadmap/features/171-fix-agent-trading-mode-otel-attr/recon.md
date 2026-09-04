# Recon: fix-agent-trading-mode-otel-attr

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-agent (+ fleet-wide convention surfaced — see Risks)

---

## Objective

Reconcile `xstockstrat-agent`'s `trading_mode` OpenTelemetry resource attribute with the
post-feature-147 model (paper/live derived from environment). The product spec framed this as an
agent-local defect; recon reveals `trading_mode` is a **fleet-wide** telemetry convention, which
reshapes the drop-vs-rename decision into a scope decision.

## Codebase Map

- **`xstockstrat-agent`** (Python) — defect site `services/xstockstrat-agent/app/telemetry.py`:
  - Env reads `:31-33` — `SERVICE_NAME`→`svc_name` (default `"agent"`), `APPLICATION_ENV`→`environment`
    (default `"development"`), `TRADING_MODE`→`trading_mode` (default `"paper"`).
  - `Resource.create({...})` `:35-42` — attributes `service.name`, `deployment.environment`,
    `trading_mode`, `platform="xstockstrat"`.
  - Telemetry is **untested**: the only test touching `init_telemetry` stubs it to a no-op
    (`services/xstockstrat-agent/tests/test_transport_config.py:38`). A resource-attribute assertion is net-new.
  - CI: `uv run pytest --cov=app --cov-fail-under=40`.

## Patterns to REUSE

- Test seam: the nearest existing telemetry test is `tests/test_transport_config.py:38` (stubs
  `init_telemetry`) — a plausible home/sibling for a net-new `Resource`-attribute assertion.
- Fleet telemetry convention (the attribute set to stay consistent with): `service.name` +
  `deployment.environment` (`APPLICATION_ENV`) + `trading_mode` (`TRADING_MODE`) + `platform`.

## Existing Business Rules (preserve / extend)

- **No existing durable acceptance guarantee governs the agent's OTel resource attributes.** The 34
  agent + 14 `platform.feature` scenarios all assert MCP tool / config-secret / RPC behavior — none on
  telemetry. C-16 is **inert** for this feature (net-new observability). A *rename* would seed a new
  `@AC-*` at launch (scenario-promoter), not amend an existing one.

## Dependencies

- Proto/RPC: none. Migration: none. Config keys: none.
- **Observability consumer**: `packages/otel/dashboards/README.md:40` documents `trading_mode` as an
  expected resource attribute (prose only). **No dashboard panel `expr` and no alert rule queries it**
  (grep of `packages/otel/**` returned exactly that one README hit). So dropping/renaming breaks no
  live query — but it contradicts the README, which must be reconciled in the same change.
- New env vars / ports: none.

## Risks / Not-found

- **PIVOTAL — `trading_mode` is a fleet-wide convention, not an agent-only attribute.** Every service
  emits it identically: Go `services/xstockstrat-trading/internal/telemetry/otel.go:44-46`
  (`attribute.String("trading_mode", os.Getenv("TRADING_MODE"))`), Node
  `services/xstockstrat-ledger/src/telemetry.ts:25-28` (`trading_mode: process.env.TRADING_MODE ?? 'paper'`),
  Python `services/xstockstrat-ingest/app/telemetry.py:33-35`. **Dropping or renaming it in the agent
  alone makes the agent the lone divergent service** — arguably worse than the current cosmetic
  mismatch. This reframes the product-spec's OQ-1 (drop vs rename) into a scope decision: agent-only
  vs fleet-wide vs de-scope.
- **`TRADING_MODE` is still a live routing axis** (portfolio `commonv1.TradingMode`; indicators/ingest
  `resolve_trading_mode`). Feature 147 removed `trading_mode` only as a **config/scope** axis, not as a
  routing concept — so a `trading_mode` telemetry label arguably still carries real paper/live routing
  signal. This weakens the "it's misleading" premise and strengthens the "leave it / it's intentional"
  reading the triage report itself flagged ("verify, not confirmed").
- Telemetry resource attributes are untested fleet-wide — any fix must add the first assertion.

## Recommended Scope

Advisory — the gate must choose among these before spec:
1. **De-scope/demote** — recognize `trading_mode` as an intentional fleet convention that still mirrors
   the live routing axis; close 171 as "not a defect" (or documentation-only: clarify the README).
2. **Agent-only drop/rename** (the product-spec's original framing) — smallest diff, but introduces
   fleet divergence; hard to justify given #1.
3. **Fleet-wide** drop or rename across all telemetry modules + the dashboards README — the only
   internally-consistent "fix", but far larger than a SEV-3 agent bug (touches all 11 services).
