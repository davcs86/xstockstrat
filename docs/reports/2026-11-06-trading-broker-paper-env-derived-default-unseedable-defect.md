# Defect: trading.broker.paper has an environment-derived default that a catalog seed cannot express

**Recorded**: 2026-11-06
**Severity**: SEV-2
**Impact type**: wrong-trading-mode-if-seeded
**Environment**: dev (feature/fix-config-keys-drift; not yet on main-dev)
**Affected service(s)**: xstockstrat-trading, xstockstrat-config
**Config-only fix possible**: no

## Observed

Feature 295's Step 6 (A2) triage found `trading.broker.paper` as `read-unseeded` in both
environments. Its reader has no literal code default: the fallback is `s.cfg.TradingMode == "paper"`,
taken from the `TRADING_MODE` env var at boot. The frozen catalog
(`scripts/config-heal/catalog.tsv`) has one `code_default` per key, so this row has an empty
`code_default`. 295's heal migration seeds "every agreeing, non-secret catalog key × {staging,
production}" with the code default (`design.md` § 036, step 3).

## Expected

The key is never seeded with one literal for both environments. Production is live and staging is
paper (root CLAUDE.md § Config Governance Rules). A `true` seed in production would route live
orders to the paper API. A `false` seed in staging would route paper accounts to the live API.

## Reproduction

1. `node scripts/check-config-wiring.mjs --json` lists
   `read-unseeded trading trading.broker.paper` (no envs, so unseeded in both).
2. `grep -P '\ttrading\.broker\.paper\t' scripts/config-heal/catalog.tsv` shows `code_default` is
   empty.
3. A seed step that inserts `code_default` for every non-secret catalog key would write `''` as a
   bool, or a guessed literal, in both environments.

## Evidence

`services/xstockstrat-trading/internal/service/trading.go:2685`
> return s.cfgW.GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")

`services/xstockstrat-trading/internal/service/trading.go:3669`
> paper := s.cfgW.GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")
