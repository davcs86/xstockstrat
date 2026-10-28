# Defect: Trader UI shows stale order status, tags orders PAPER while the mode is unknown, runs symbol-page backtests that earn no evidence, and hides failed user actions

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: misleading-trading-ui
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ui, xstockstrat-analysis (D-45 evidence/history semantics)
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), findings D-11, D-17, D-45, D-64 (plus open question NC-D). Re-verified against main-dev @ a053b0e.

## Observed

### D-11 — Order book: stream drop is silent and stream records override fresher polls

`useOrderUpdates` consumes `StreamOrderUpdates` and stores the last streamed record per `orderId`. Any
stream error (server restart, network drop, deadline) is swallowed by an empty `catch`, and the hook
never reconnects. `OrdersTable` then prefers the streamed record over the polled one
(`liveUpdates[o.orderId] ?? o`) regardless of which is newer. A stale streamed NEW or PARTIALLY_FILLED
status therefore masks the poll's FILLED or CANCELED, and the user sees no sign the live feed has stopped.
`AlertStream` has the same silent-stop pattern for the notify stream.

### D-17 — UI defaults trading mode to `'paper'` while the environment is unknown

Five trader pages compute `environmentMode ?? 'paper'`. `AccountContext` leaves `environmentMode`
undefined when `GetTradingEnvironment` fails. `OrderForm` then sends `tradingMode: PAPER`, and
`useOrders` filters by PAPER. On production (live), a PAPER-tagged order executes live but is booked to
a PAPER portfolio row (a mis-tag, not a mis-route), and the order list shows the wrong mode's orders.

### D-45 — Symbol-page backtest omits `strategyId`, so the run earns no evidence and never appears in history

The `/trader/positions/[symbol]` backtest runner calls `runBacktest({ strategyIdRef: strategyId, … })`
without `strategyId`. Analysis fingerprints the executed definition (evidence toward the grade) only when
`strategy_id == strategy_id_ref`, and keys run history and grade recompute on `request.strategy_id`.
With `strategy_id` empty, the run earns no evidence and is invisible on the page that started it, even
though the page invalidates `['analysis-backtests', strategyId]` and its comment claims it matches the
reference runner on `/insights/strategies/[id]` (which sends both).

### D-64 — three user actions fail silently

- `/insights/opportunities`: Snooze / Dismiss / Take call `setAction.mutate(...)` with no `onError`; the
  hook has no `onError`, `setAction.error` is never read, and the query client sets no global mutation
  error handler.
- `/insights/signal-sources`: `handleToggle` (activate/deactivate) has no `onError`, while its siblings
  `saveWeight` and `handleSave` surface errors.
- `/trader/portfolio`: `onExportEvents` returns silently on `!res.ok`, and a network reject becomes an
  unhandled promise rejection.

The surveyor rated D-64 one tier lower on its own; it is grouped here as the same "trader/insights UI
gives the user wrong or no feedback" theme.

## Expected

- D-11: a dropped order stream is visible to the user and reconnects with backoff; the table shows the
  newer of the streamed and polled record (by `updatedAt`), so a terminal polled status is never masked.
- D-17: while the environment is unknown, the UI does not assert PAPER — it sends
  `TRADING_MODE_UNSPECIFIED` (server derives mode from environment) or blocks order entry until the mode
  is known.
- D-45: a symbol-page run sends `strategyId` alongside `strategyIdRef`, earns evidence like the reference
  runner, and appears in that strategy's backtest history.
- D-64: each of the three actions shows an error to the user when it fails.

## Reproduction

1. D-11: open `/trader/orders` with an open order; kill or restart `xstockstrat-trading` (stream drops);
   fill or cancel the order via the broker. The poll returns FILLED/CANCELED but the table keeps showing
   the streamed NEW/PARTIALLY_FILLED, with no indicator that the stream stopped.
2. D-17: make `GetTradingEnvironment` fail (e.g. BFF returns 503) on a production deploy; submit an order
   from `/trader`. The request carries `tradingMode: PAPER`.
3. D-45: on `/trader/positions/AAPL?strategy=<id>` run a backtest. Open `/insights/strategies/<id>`: the
   run is absent from history and the grade's evidence count is unchanged. Run from the strategy page
   instead: it appears and counts.
4. D-64: make `SetOpportunityAction`, `ManageSignalSource` (deactivate) or `/trader/api/ledger/export`
   fail; click the action. Nothing is shown.

## Evidence

### D-11 — Order stream silent stop and override

`services/xstockstrat-ui/src/hooks/useOrderUpdates.ts:25-27`
> } catch {
>   // Stream aborted (unmount) or interrupted — silent stop.
> }

`services/xstockstrat-ui/src/components/trader/OrdersTable.tsx:66`
> () => orders.map((o) => liveUpdates[o.orderId] ?? o),

`services/xstockstrat-ui/src/components/trader/AlertStream.tsx:44-46`
> } catch {
>   // Stream aborted (unmount) or interrupted — EventSource-style silent stop.

### D-17 — PAPER default while mode unknown

`services/xstockstrat-ui/src/app/trader/page.tsx:19` (also `orders/page.tsx:16`, `positions/page.tsx:48`, `positions/[symbol]/page.tsx:110`, `portfolio/page.tsx:27`)
> const mode: TradingMode = environmentMode ?? 'paper';

`services/xstockstrat-ui/src/context/AccountContext.tsx:61-62` (scan cited `:60`)
> } catch {
>   // non-fatal — leave mode unknown

`services/xstockstrat-ui/src/components/trader/OrderForm.tsx:139`
> tradingMode: mode === 'live' ? PbTradingMode.LIVE : PbTradingMode.PAPER,

### D-45 — Symbol-page backtest omits `strategyId`

`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:1144-1158`
> // Fixed default window/capital, matching the reference runner on /insights/strategies/[id].
> runBacktest(
>   { strategyIdRef: strategyId, symbols: [symbol], ... },
>   { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['analysis-backtests', strategyId] }) },

`services/xstockstrat-ui/src/app/insights/strategies/[id]/page.tsx:101-103`
> strategyId: id,
> // strategyIdRef runs the registered definition so the run earns evidence toward the grade.
> strategyIdRef: id,

`services/xstockstrat-analysis/app/handlers/servicer.py:865-870`
> if (request.strategy_id_ref and request.strategy_id == request.strategy_id_ref and executed_row is not None):
>     run_fingerprint = _definition_fingerprint(executed_row["definition_json"])

History and grade are keyed on `request.strategy_id` (`servicer.py:1280-1310` cell/run persistence,
`:1322` `_recompute_headline(caller_user_id, request.strategy_id, …)`).

### D-64 — silent action failures

`services/xstockstrat-ui/src/app/insights/opportunities/page.tsx:155-156`
> const act = (o: Opportunity, action: OpportunityAction) =>
>   setAction.mutate({ opportunityKey: o.opportunityKey, action });

`services/xstockstrat-ui/src/hooks/useOpportunities.ts:65-70` and `src/hooks/useInvalidatingMutation.ts:20-29`
(no `onError`); `src/lib/queryClient.ts:11-17` (no mutation defaults).

`services/xstockstrat-ui/src/app/insights/signal-sources/page.tsx:254-263` (`handleToggle`, no `onError`;
siblings surface errors at `:226` and `:296`/`:332`).

`services/xstockstrat-ui/src/app/trader/portfolio/page.tsx:108-113`
> const res = await fetch(`/trader/api/ledger/export?${qs.toString()}`);
> if (!res.ok) return;

### Open question NC-D — does an empty `strategy_id` write phantom rows?

The surveyor asked whether `strategy_id=''` creates or overwrites a phantom `''` row in
`analysis.strategy_scores_v2`. Partial evidence at triage: `_recompute_headline` resolves
`get_by_owner_and_id(user_id, '')` before locking and returns `None` on a miss
(`servicer.py:2811-2826`), so the headline-grade path likely no-ops unless a strategy with id `''`
exists. The run-history and per-symbol cell rows (`servicer.py:1280-1310`) are still persisted keyed
`''`. Unconfirmed; to be settled in design.

## Root cause hypothesis

- D-11: the stream hook was written as fire-and-forget with no reconnect or freshness comparison.
- D-17: a client-side default was chosen for display convenience and leaked into the order request.
- D-45: the symbol-page runner copied only half of the reference runner's request.
- D-64: mutations rely on per-call `onError` and three call sites omit it; there is no global fallback.

## Confidence

high
