# Defect: config-ui shows duplicate rows for a key and can't save it

**Recorded**: 2026-08-07
**Severity**: SEV-3
**Impact type**: duplicate-config-key-rows
**Environment**: dev (main-dev)
**Affected service(s)**: xstockstrat-config, xstockstrat-ui
**Config-only fix possible**: no

## Observed

On `/config-ui/marketdata?env=dev&mode=paper`, `marketdata.fmp.enabled` appears twice in the
key table. Clicking Edit on either row puts both into edit mode simultaneously (both show the
input in place of the value), and Save does not reliably update the key.

## Expected

Each config key appears exactly once per (namespace, environment, mode) view, and Save updates
the value that is actually displayed.

## Reproduction

1. Open `/config-ui/marketdata?env=dev&mode=paper`.
2. Observe `marketdata.fmp.enabled` listed twice.
3. Click Edit on either occurrence — both rows enter edit mode.
4. Click Save — the write is refused or does not visibly take effect.

## Evidence

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:358-367` (before fix)
> `SELECT key, ... FROM config.config_values WHERE namespace = $1 AND environment = $2 AND (trading_mode = $3 OR trading_mode = 'all')`
> — no de-dup: a key registered with a `trading_mode='all'` row that also has a mode-exact
> shadow row for the same (namespace, key, environment) matches twice and is returned as two
> array entries.

`services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx:131,134,166` (before fix)
> `<TableRow key={k.key}>` … `editingKey === k.key` — rows/edit-state are keyed on the bare
> key string, so two rows sharing a key collide in the UI (both enter edit mode together).

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:302-335` (`setConfig`)
> the existence gate matches the write's scope EXACTLY (`environment = $3 AND trading_mode = $4`,
> no `OR trading_mode = 'all'` broadening, by design — see the comment at :315-321). The page
> previously sent the *page's viewed* mode on Save regardless of the row's actual registered
> scope, so saving a key registered only as `'all'` while viewing `paper`/`live` was refused
> `NOT_FOUND`.

## Root cause hypothesis

Two related defects in the same read/write path:
1. `listKeys` has no precedence rule between an `'all'`-scoped row and a mode-exact row for the
   same key, so both are returned when both exist — a duplicate list entry.
2. `page.tsx`'s Save handler targeted the page's currently-viewed `(environment, tradingMode)`
   instead of the row's own registered scope (`k.environment`/`k.tradingMode`, already present
   in the `ListKeys` response), so `setConfig`'s exact-scope existence gate rejected legitimate
   edits to any key registered only as `trading_mode='all'`.

## Confidence

high

## Fix

- `configServiceImpl.ts` `listKeys`: de-duplicate by key, preferring the mode-exact row over
  `'all'` when both exist.
- `[namespace]/page.tsx` `handleSave`: send the row's own `environment`/`tradingMode` (from the
  `ListKeys` response) instead of the page's viewed filter state.
- Added `services/xstockstrat-config/src/__tests__/listKeysDedup.test.ts` covering both DB row
  orderings and the single-row (unaffected) case.

Note: `reloadAll`/`reloadNamespace` (the `WatchConfig`/`GetConfig` read paths) have the same
underlying `(trading_mode = $mode OR trading_mode = 'all')` scope-matching with no precedence
rule, but resolve to a single value via a JS object assignment rather than an array, so a
duplicate-scope key there produces silent, DB-row-order-dependent value selection instead of a
visibly duplicated list — a related latent risk, called out but not changed here since it wasn't
observed and is a larger-blast-radius change (every WatchConfig subscriber) than this UI-scoped
fix.
