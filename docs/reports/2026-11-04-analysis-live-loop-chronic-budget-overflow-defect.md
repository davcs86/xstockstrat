# Defect: analysis live loop is permanently over its per-cycle pair budget and WARNs every cycle

**Recorded**: 2026-11-04
**Severity**: SEV-3
**Impact type**: signal-latency-and-log-noise
**Environment**: dev (main-dev) — Grafana `deployment_environment=staging`
**Affected service(s)**: xstockstrat-analysis
**Config-only fix possible**: yes

## Observed

670–696 live (strategy, symbol) pairs across 3 strategies versus `analysis.engine.max_strategies_per_cycle=50`
(default). Each cycle (~68 s apart) evaluates 50 pairs in 2.3–2.8 s, WARNs, and rotates, so a full rotation takes
~14 cycles (~16 min). About 5.6k WARN lines in 7 days (e.g. 1,922 for 670 pairs, 1,595 for 696 pairs). A steady
state, not an incident, is logged at WARN indefinitely, and each pair is evaluated at most once per ~16 min.

## Expected

Budget sized to the fleet (or the steady-state condition logged once / at a lower level), so WARN signals a real
change and signal latency is not silently ~16 min.

## Reproduction

1. Query `{service_name="analysis", deployment_environment="staging"} |= "exceed max_strategies_per_cycle"`.
2. One line per cycle, pair count 670–696, window advancing by 50.

## Evidence

`services/xstockstrat-analysis/app/engine/live_loop.py:446-461`
> "live_loop: %d live (strategy,symbol) pairs across %d strategies exceed max_strategies_per_cycle=%d — evaluating %d this cycle …"

Loki:
> `live_loop: evaluated 50/682 pairs in 2.4s (errors=0, no_bars=0); cursor now at …`

## Root cause hypothesis

The fleet grew past the default budget. A 50-pair cycle takes ~2.5 s of a ~68 s cadence, so a materially larger
`analysis.engine.max_strategies_per_cycle` appears to fit (operator decision; load and Alpaca/indicators capacity
not verified). Whether the WARN should also be throttled is a separate code question.

## Confidence

low

## Triage (classification only, 2026-11-04)

Track B (config-only) per the config-only field. No config key changed; status remains `open` until the
operator applies the value and confirms (B-3).

Applied (2026-11-04, operator asked for both): `set_config analysis.engine.max_strategies_per_cycle = 200`
(int, `create_key=true`) on staging; propagation verified in Loki (`max_strategies_per_cycle=200`, 200/690 pairs in
23.6s, rotation ~4 cycles). The value was chosen by the assistant, not the operator. The overflow WARN still fires
(690 > 200). Durable fix tracked as feature 293 (`fix-analysis-live-loop-budget-seed`); sidecar `triaged`.

Triage findings (2026-11-04): `analysis.engine.max_strategies_per_cycle` is **not registered** in the staging
config (absent from `get_config` / `list_config_keys` for `analysis`), so the service runs on its code default
of 50 and a plain `SetConfig` is refused `NOT_FOUND` by the feature 091 existence gate. Applying the fix therefore
needs `set_config(..., create_key=true, value_type=int)`. That creates a runtime key invisible to migrations
(`docs/patterns/config-governance.md:90`) — a follow-up seed migration is the durable alternative. The value is
an operator decision: capacity of indicators/marketdata at larger batches was not verified.
