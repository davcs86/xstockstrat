# xstockstrat-portfolio — `portfolio.position.closed` producer contract

**`portfolio.position.closed` payload — producer contract (feature 042).** The full-close emit in
`ConsumeOrderFills` carries `{user_id, symbol, account_id, trading_mode, realized_pnl}`, where
`trading_mode` is `mode.String()` (e.g. `TRADING_MODE_PAPER`) and `realized_pnl` is the position's
sealed realized P&L (`realized_accum` accumulated over the reducing fills **plus** the closing fill's
delta). `xstockstrat-analysis`'s P&L-pattern consumer reads this back to seal a position's window
without recomputing P&L, so the key set is a **contract** — do not drop or rename these keys.
**Additive extensions (base keys unchanged, C-16):** feature 029 adds `fees_total` (JSON number,
the sealed cumulative fees — `realized_pnl` stays gross/authoritative, `net = realized_pnl −
fees_total` downstream); feature 031 adds `cost_basis` (JSON number, `existing.CostBasis`,
total-signed) and `opened_at` (RFC3339 string, `existing.OpenedAt`) **when the closing position row
was present** (both omitted on the redelivered-post-close `existing == nil` edge, alongside the
`realized_pnl`/`fees_total` `0` it already emits there). The `xstockstrat-ui` `/insights` performance
dashboard reads `cost_basis` for average return per trade and `opened_at` for average hold time; the
payload is built by the pure `closedPositionPayload` helper (unit-tested in
`portfolio_close_payload_test.go`). The
`positions.realized_accum` column (migration `010`) that backs it is **attribution-stats-only and
never a user-facing figure** — `GetPnL` remains the authoritative realized P&L. **Named v1 scope
limitation:** `realized_accum` is exact only for **long, order-fill-originated** positions; a short
opened via `account.positions.synced` and covered by a live buy takes the "buying more" branch, so
`realizedDelta` is not invoked and `realized_accum` understates (attribution-only impact; `GetPnL`
still returns the true figure). It is deliberately **not** accumulated in `ConsumePositionSyncs`
(sync has no per-leg price — would reintroduce the feature-056 dual-source bug).
