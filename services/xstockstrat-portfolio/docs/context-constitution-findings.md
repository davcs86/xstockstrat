# xstockstrat-portfolio — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — all open rows re-verified, still reproduce; re-anchored
2026-09-03 (branch `claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327`) after feature-170
`portfolio_service.go` line shifts — all rows still reproduce, none resolved). For
triage/fixing, not governance; re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — value-parity row narrowed (GetPnL fixed) + partial-pricing/broker-valued-fetch note; added `r.pool` half-migration row and root cross-ref for the quote-deadline bound gap; line hints re-stamped, all open rows re-verified). Repo-wide defects (Go 1.22 doc-lie) live in the root findings log.

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Snapshot-equity / risk value-parity break**: `broadcastSnapshot` and `checkRiskLimits` recompute market value from mid-quotes instead of the broker-authoritative `unvaluedSymbols`/`applyQuotes` rule (PORTFOLIO-1). (partially resolved 2026-10-19: `GetPnL` now values via broker `current_price` + `unvaluedSymbols`/`applyQuotes` and fails `ErrQuotesUnavailable` — `portfolio_service.go#GetPnL`.) Also: `broadcastSnapshot` still persists when only *some* positions priced (unpriced count as 0 → understated equity), and both paths fetch quotes for broker-valued positions too. | For any broker-synced position (`CurrentPrice > 0`), snapshot equity and risk-concentration numbers diverge from what the UI is shown via `ListPositions`/`GetPortfolio`; a partial quote batch persists an understated equity snapshot. | `portfolio_service.go#broadcastSnapshot (~L827; all-symbol fetch ~L833-837, skip only when nothing priced ~L847)`, `#checkRiskLimits (~L891; ~L905)`; contract asserted `portfolio_repo.go#ListPositions` (~L165-166), `migrations/005_positions_broker_valuation.up.sql` (~L4-9) |
| **`CreateWatchlist` collapses a duplicate-name collision to `CodeInternal`** (surfaced 2026-08-26, feature 127 archive): a `UNIQUE(user_id,name)` violation returns `connect.CodeInternal`, indistinguishable from a DB outage — callers can't match `ALREADY_EXISTS`. Fix: map the unique-violation to `CodeAlreadyExists`; `EnsureSignalWatchlist`'s atomic find-or-create is the only race-safe path today. | A duplicate watchlist-name create is reported as an internal error, not a client error; callers cannot distinguish it from an outage and cannot branch/retry correctly. | `internal/service/portfolio_service.go#CreateWatchlist (~L1555)` (`CodeInternal` returns ~L1571,1579 — no `ALREADY_EXISTS` branch) |
| **`portfolio.marketdata.quote_timeout_ms` cross-key bound gap** — see root findings "Cross-hop deadline ordering is documented but not enforced by per-key bounds" (found 2026-10-19) | see root | `../../../docs/context-constitution-findings.md` |

## Dead / orphaned code

| What | Why it looks dead | Evidence |
|---|---|---|
| ~~`portfolio.risk.max_drawdown_pct` config key~~ **RESOLVED (feature 172)**: now enforced per-account — `checkRiskLimits` fetches `GetAccountDrawdowns` and `evaluateDrawdowns` emits a WARNING alert on breach (peak_equity HWM, migration 016) | ~~read then discarded~~ now enforced | `portfolio_service.go#checkRiskLimits` (`GetFloat` ~L892, `GetAccountDrawdowns`/`evaluateDrawdowns` enforcement ~L925-927 — formerly the `_ = maxDrawdownPct` discard) |
| **`PortfolioRepo` `r.pool` → `r.db` half-migration**: `GetSnapshot`, `CountPositions`, `UpdatePositionBracket`, `UpsertOfflineRealized`, `DeleteOfflineRealized` still call `r.pool`, while `NewPortfolioRepoWithDB` (pgxmock) leaves `pool` nil — action: move them to `r.db` (found 2026-10-19) | the mockable `db` surface was adopted for the other methods; these five nil-panic under the pgxmock constructor, so they are untestable that way | `internal/repository/portfolio_repo.go#NewPortfolioRepoWithDB (~L48)`; `r.pool` calls ~L216/240/340/462/486 |

## Open questions (unresolved *why* — needs a maintainer)

- On process restart the first ledger connect replays `order.filled` from sequence 0 and `processOrderFill` applies **incremental** qty to the persisted row — does a restart double-count fills, or is it always corrected by the `account.positions.synced` broker snapshot? If some accounts never receive broker syncs, replay-from-0 is a latent double-count. `internal/service/portfolio_service.go#consumeEventStream (~L180)`, `#streamEventsFrom (~L201)`, `cmd/server/main.go` (`go svc.ConsumeOrderFills(ctx)`) — status: **confirmed defect**, recorded in `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect.md`. Quantity self-heals only for synced accounts, and `realized_accum`/`fees_accum` inflate permanently on every restart.
- **Restart double-count is now confirmed (2026-10-14):** `cmd/server/main.go` starts `go svc.ConsumeOrderFills(ctx)` and `consumeEventStream` starts with `lastSeq = 0`, so every boot replays `order.filled` from sequence 0. Defect report `docs/reports/2026-10-06-portfolio-fill-fold-not-exactly-once-defect` is `open`; its sibling `docs/reports/2026-10-03-portfolio-fill-sync-lost-update-defect` is `triaged` (`commit:909540a`, the `positionsMu` fix — PORTFOLIO-14).
- `UpsertPositionFromSync` sets `cost_basis = qty * avgCost` but leaves `realized_accum` / `fees_accum` untouched (CLAUDE.md calls this deliberate) — is there a plan to reconcile accumulators against broker syncs, given the restart-replay inflation? — status: **open**
- `processPositionSync` defaults `userID` to the literal `"default"` and the deregister handler does the same, and `processOrderFill` defaults the account to `"alpaca-default"` — are these legacy fallbacks still reachable? — status: **open**
- `emitEvent` uses a fresh `uuid.NewString()` per call as the idempotency key, so dedup protects only in-flight retries, not event reprocessing — is retry-only dedup the intended scope? `portfolio_service.go#emitEvent (~L949)` (`uuid.NewString()` ~L963) — status: **open**


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-cross-hop-deadline-bounds-unenforced-defect`](../../../docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md) | Cross-hop read deadline ordering is not enforced by config bounds |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |
| [`2026-10-19-portfolio-concentration-logged-as-drawdown-defect`](../../../docs/reports/2026-10-19-portfolio-concentration-logged-as-drawdown-defect.md) | concentration breaches are recorded as portfolio.risk.drawdown_breach ledger events |
| [`2026-10-19-portfolio-default-identity-fallback-defect`](../../../docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md) | portfolio consumers substitute literal "default" / "alpaca-default" for a missing user or account id |
| [`2026-10-19-portfolio-snapshot-risk-midquote-valuation-defect`](../../../docs/reports/2026-10-19-portfolio-snapshot-risk-midquote-valuation-defect.md) | portfolio snapshot equity and risk checks value positions from mid-quotes, not broker marks |
| [`2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect`](../../../docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md) | CreateWatchlist returns INTERNAL on a duplicate watchlist name |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
