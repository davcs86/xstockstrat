# Defect: trading service never resolves live config — `platform.trading_state` stuck at the fail-closed `HALTED` default (CONFIG-9 violation)

**Recorded**: 2026-09-15
**Severity**: SEV-1 (candidate — confirm at triage)
**Impact type**: config-not-applied / trading-path-blocked
**Environment**: staging + production (deployment-agnostic — a code/seed contract fault, not a data value)
**Affected service(s)**: xstockstrat-trading (primary); xstockstrat-portfolio, xstockstrat-marketdata (same latent pattern)
**Config-only fix possible**: no (code change to the Go config watcher and/or a seed-key migration; a value edit cannot fix it)

## Observed

Placing an order in the trader UI (`/trader`, paper/Alpaca-test account → staging) is rejected with:

```
internal: rpc error: code = FailedPrecondition desc = trading halted: platform.trading_state=HALTED
```

The rejection persists **regardless of the real config value**. During triage the config service was
observed holding `platform.trading_state = REDUCE_ONLY`, then explicitly set to `ACTIVE` via
`SetConfig` (confirmed on read-back, version `1789457959030`) — the trader UI **still** reported
`platform.trading_state=HALTED`. The value the trading service enforces is decoupled from the value
config-service actually stores.

## Expected

`checkTradingStateForPlaceOrder` (`services/xstockstrat-trading/internal/service/trading.go:3249`)
should resolve the **live** `platform.trading_state` broadcast by `xstockstrat-config` over
`WatchConfig`. With config holding `ACTIVE`, an exposure-increasing BUY should pass the trading-state
gate. With `REDUCE_ONLY`, it should hit the reduce-only branch (message `"trading reduce-only: …"`),
never the `HALTED` branch.

## Root cause

`currentTradingState()` reads the value with a **full-dotted getter string** and a fail-closed default:

- `services/xstockstrat-trading/internal/service/trading.go:3220-3221`
  > `return parseTradingState(s.cfgW.GetString("platform.trading_state", "HALTED"))`
- `services/xstockstrat-trading/internal/service/trading.go:3254`
  > `return grpcstatus.Errorf(codes.FailedPrecondition, "trading halted: platform.trading_state=HALTED")`
- `parseTradingState` (`:3207-3215`) maps `""`/unrecognized → `tradingStateHalted`.

That getter lookup **can never hit**, for two independent reasons — either alone reproduces the bug:

1. **Namespace scoping.** The watcher subscribes to a **single** namespace, `"trading"`
   (`services/xstockstrat-trading/cmd/server/main.go:61` →
   `config.NewWatcher(cfg.ConfigEndpoint, "trading", …)`; request built at
   `internal/config/config.go:125-126` with `Namespace: w.namespace`). The config server filters each
   subscription `WHERE namespace = $1` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:189`),
   so **no `platform.*` row is ever streamed to trading** — not `trading_state`, not `maintenance_mode`
   (`trading.go:344` reads `platform.maintenance_mode`, also permanently defaulting).

2. **Key-format mismatch (CONFIG-9 violation).** WatchConfig snapshots are keyed by the **raw `key`
   column with no namespace prefix** (constitution **CONFIG-9**,
   `services/xstockstrat-config/docs/context-constitution.md:26`; also `insights.md:905`). The Go watcher
   stores `snap.Values` verbatim (`internal/config/config.go:144,147`) and `GetString` does a raw
   `w.snapshot[key]` lookup (`:167-174`). Seed migration `011_platform_trading_state.up.sql` stored the
   key as a **namespace-relative fragment** — `(namespace='platform', key='trading_state')` — but the
   reader passes the **full-dotted** `"platform.trading_state"`. Stored key ≠ getter string → miss →
   fail-closed `HALTED`. Live `get_config` confirms the stored form is bare: the `platform` namespace
   returns `trading_state` (not `platform.trading_state`).

**Result:** every exposure-increasing `PlaceOrder`/`ReplaceOrder` is rejected with
`platform.trading_state=HALTED` independent of the operator's actual setting, and the reconciliation
kill-switch is uncontrollable from either direction. `escalateSystemic` (`trading.go:1895-1906`) *writes*
`SetConfig(namespace='platform', key='trading_state')` — bare, matching the seed/writer convention — so
writer and store agree; only the **reader** is out of contract.

## Blast radius (why critical, not low like the mcp_client precedent)

The same "store `snap.Values` verbatim (bare keys) + read with full-dotted getters" pattern is present
in **all three Go watchers** — `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`
(identical `w.snapshot = snap.Values` at `portfolio/internal/config/config.go:213` and
`marketdata/internal/config/config.go:228`). Live `get_config` for the `trading` namespace returns bare
keys (`risk.sizing_enabled`, `risk.max_risk_per_trade_pct`, …), so **every `trading.*` getter also
misses and silently runs on its code default.** It is invisible for all keys except `platform.trading_state`
because that is the one key whose code default (`HALTED`) diverges from its intended seed (`ACTIVE`);
every other key's code default happens to equal its seed, masking the fault. Consequences:

- **Trading-path-blocking (critical):** the trading kill-switch is jammed `HALTED` — the platform cannot
  place orders, and an operator cannot un-halt it via config. The emergency `platform.maintenance_mode`
  lever is broken by the same reader path, so it too cannot halt/steer trading through this service.
- **Silent config-not-applied (latent):** all operator retuning of `trading.risk.*` (risk-per-trade,
  concentration/position caps, bracket toggles, approval thresholds) is a silent no-op; the safety limits
  in force are the hardcoded defaults, not what an operator sets.

This is the same defect class as `docs/reports/2026-09-03-mcp-client-config-keys-unprefixed-defect.md`
(a lower-severity, two-key instance), but far wider: there it was two ingest tuning keys; here it is
trading's entire config surface plus the safety kill-switch. **Note on the failure mode:** it is
fail-*safe* — orders are blocked, never wrongly executed — so there is no active financial-integrity
bleed, only a trading outage. That nuance bears on the track decision below.

## Reproduction

1. Staging, paper account. Confirm `get_config platform` → `trading_state` is any value **other than**
   `ACTIVE` is not required — the bug reproduces even at `ACTIVE`.
2. `set_config platform.trading_state = ACTIVE` (confirm read-back shows `ACTIVE`).
3. Place a market BUY on any symbol with an explicit qty via `/trader`.
4. **Observed:** `FailedPrecondition … trading halted: platform.trading_state=HALTED`.
   **Expected:** order accepted (or, under a real `REDUCE_ONLY`, a `"trading reduce-only: …"` message).

## Root-cause hypothesis / candidate fixes (for design, not yet chosen)

The invariant to restore (CONFIG-9): the effective snapshot key the getter looks up **must equal** the
stored key, and the watcher must actually **receive** the namespace that carries each key. Leading
candidates, to be settled in design with adversarial review (safety-critical surface):

- **(A) Watcher-side, preferred hypothesis:** have the Go watcher (a) subscribe to **both** the service's
  own namespace **and** `platform`, and (b) **prefix each snapshot key with its namespace** on ingest
  (`w.snapshot[namespace+"."+k] = v`), so the existing full-dotted getters (`platform.trading_state`,
  `trading.risk.*`) resolve and cross-namespace bare-key collisions can't occur. No getter call-sites or
  seeds change; writers already agree. Applies uniformly to trading/portfolio/marketdata.
- **(B) Seed + writer migration:** rewrite the `key` column to the full-dotted form and update every
  writer (`escalateSystemic`, config-ui, agent `set_config`) and the platform-namespace subscription to
  match. Larger surface; must reconcile the `ON CONFLICT (namespace,key,environment,user_id)` addressing.
- **(C) Reader alignment:** change trading's getters to the bare stored keys and add a `platform`
  subscription. Consistent with the existing writer/seed convention but touches ~25 call-sites and does
  not generalize as cleanly.

A regression test must assert that a value set through `SetConfig` is observed by the consuming getter
(the read-path coverage `config_test.go` currently lacks — it exercises only `LoadFromEnv`/`SetConfig`,
never `GetString`/`GetBool` against a populated snapshot, which is why this shipped).

## Interim mitigation applied

`platform.trading_state` was set to `ACTIVE` in staging (audit: author `davcs86@gmail.com`). This does
**not** unblock trading — the reader never sees it — and is recorded only so the stored value is not left
at an incident-time `REDUCE_ONLY`. The code fix is required to actually resolve the halt.

## Confidence

High. Four independent confirmations: live `get_config` (bare keys; `ACTIVE` set yet UI still `HALTED`),
the config-server source (`resolveOverlayValues`/`reloadNamespace` emit `values[row.key]`), the trading
reader source (single-namespace subscribe + verbatim snapshot + dotted getters), and constitution
**CONFIG-9** / `insights.md:905` documenting the exact keying rule this violates.
