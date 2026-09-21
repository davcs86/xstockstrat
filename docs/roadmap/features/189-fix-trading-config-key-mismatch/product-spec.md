# Product Spec: fix-trading-config-key-mismatch

**Type**: bug
**Defect Report**: `docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md`
**Severity**: SEV-1
**Created**: 2026-09-15

---

## Problem Statement

**Observed:** Placing an order in the trader UI is rejected with `FailedPrecondition … trading halted:
platform.trading_state=HALTED`, and the rejection persists even after `platform.trading_state` is set to
`ACTIVE` in config-service (verified: value set to `ACTIVE`, read-back confirmed, UI still `HALTED`).

**Expected:** `checkTradingStateForPlaceOrder` (`trading.go:3249`) resolves the live
`platform.trading_state` broadcast over `WatchConfig`. `ACTIVE` → an exposure-increasing BUY passes the
gate; `REDUCE_ONLY` → the reduce-only branch (`"trading reduce-only: …"`); only a real `HALTED` → the
halt branch. The enforced value must track what config-service stores.

## Reproduction Steps

1. Staging, paper account. `set_config platform.trading_state = ACTIVE` (confirm read-back = `ACTIVE`).
2. Place a market BUY with an explicit qty via `/trader`.
3. Observed: `trading halted: platform.trading_state=HALTED`. Expected: order accepted.

## Root Cause Hypothesis

Two independent faults, either sufficient (full analysis in the defect report):

1. **Namespace scoping** — trading subscribes to the single `"trading"` namespace
   (`cmd/server/main.go:61`); the config server filters `WHERE namespace=$1`
   (`configServiceImpl.ts:189`), so `platform.*` rows never reach trading.
2. **Key-format / CONFIG-9 violation** — snapshots are keyed by the raw `key` column with no namespace
   prefix (constitution **CONFIG-9**, `services/xstockstrat-config/docs/context-constitution.md:26`).
   Migration `011_platform_trading_state.up.sql` stores `key='trading_state'` (namespace-relative), but
   the reader passes full-dotted `GetString("platform.trading_state")` (`trading.go:3221`) → miss →
   fail-closed `HALTED` default. Same verbatim-snapshot + dotted-read pattern in trading's own
   `trading.*` reads and in portfolio/marketdata.

## Affected Services

- **xstockstrat-trading** (primary) — kill-switch gate + all `trading.*` config reads
- **xstockstrat-portfolio**, **xstockstrat-marketdata** — identical latent watcher pattern
- **xstockstrat-config** — only if the chosen approach rewrites the seed `key` column (a migration)

## Fix Scope

- [ ] No proto changes anticipated — **holds** (no contract change expected)
- [x] A database migration is **likely** — if the approach aligns the seed `key` column to full-dotted
- [x] Config key changes involved — the `platform.trading_state` / `platform.maintenance_mode` /
      `trading.*` seed rows are in scope depending on approach (data, not new keys)

Candidate approaches (to be decided in `/sdd-design` under adversarial review — do not pre-commit):

- **(A) Watcher-side (preferred hypothesis):** each Go watcher subscribes to its own namespace **and**
  `platform`, and prefixes snapshot keys with the namespace on ingest (`snapshot[ns+"."+k]=v`), so the
  existing full-dotted getters resolve and cross-namespace bare keys don't collide. No getter/seed/writer
  changes; writers already agree.
- **(B) Seed + writer migration:** rewrite the `key` column to full-dotted and update every writer
  (`escalateSystemic`, config-ui, agent `set_config`) + the platform subscription. Larger surface.
- **(C) Reader alignment:** change trading's getters to the bare stored keys + add a `platform`
  subscription. Touches ~25 call-sites; does not generalize as cleanly.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass after
the fix (Constitution **C-15**). A read-path test asserting a value set via `SetConfig` is observed by
the consuming getter (coverage `trading/internal/config/config_test.go` currently lacks — it never
exercises `GetString`/`GetBool` against a populated snapshot, which is why this shipped). Plus: existing
tests pass; trading (and any other touched service) smoke-tested on dev.

## Out of Scope

- Refactoring unrelated to the config-resolution contract
- Widening the config model (per-user platform state, new keys, etc.)
- The separate feature-179 per-account halt / Resume UI (different mechanism)
