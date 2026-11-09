# Defect: trading reads int-documented config keys with GetFloat (and the same key with both accessors)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: config-value-silently-zeroed
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading
**Config-only fix possible**: no
**Source**: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Latent bugs, rows 3–4

## Observed
`Watcher.GetInt` and `GetFloat` each decode only their own `oneof` branch of `config.v1.ConfigValue`.
If a key is present but stored as the other branch, the getter returns `0`, not the coded default.
- `trading.order.max_retries` and `trading.order.retry_delay_ms` are documented as `int` but are read
  with `GetFloat` in `flattenAndHalt`. A row written as `int_val` reads as `0`, so the emergency
  flatten gets one attempt, no retries, and no delay.
- `trading.broker.timeout_ms` is read with `GetFloat` in `brokerCallTimeout` and with `GetInt` in
  `instantiateBrokerLocked` and `staleThreshold`. Whichever type the row has, one set of sites
  ignores the configured value. `brokerCallTimeout` turns `0` back into `5000`, so the operator's
  value is silently dropped.

This is latent today because none of these keys has a seed row, so every site uses its default.

## Expected
Each key uses one accessor that matches its documented type, or the getters coerce between the
int and float branches.

## Reproduction
1. `SetConfig trading.order.max_retries=3` with `value_type=int`.
2. Trigger a protection-window flatten whose broker submission fails transiently.
3. Observe a single submit attempt, then halt (`maxRetries == 0`).

## Evidence
`services/xstockstrat-trading/internal/config/config.go:242`
> return v.GetFloatVal()

`services/xstockstrat-trading/internal/service/trading.go:2748`
> maxRetries := int(s.cfgW.GetFloat("trading.order.max_retries", 3))

`services/xstockstrat-trading/internal/service/trading.go:2359`
> ms := s.cfgW.GetFloat("trading.broker.timeout_ms", 5000)

`services/xstockstrat-trading/internal/service/order_intent.go:100`
> brokerMs := cfgW.GetInt("trading.broker.timeout_ms", 5000)

## Root cause hypothesis
The getters are strictly typed by oneof branch, there is no per-key type discipline, and the
config seeds don't pin `value_type` for these keys.

## Confidence
high
