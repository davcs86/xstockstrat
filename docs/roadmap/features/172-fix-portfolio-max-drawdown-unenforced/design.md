# Design: fix-portfolio-max-drawdown-unenforced

**Created**: 2026-09-04
**Rounds**: 3 (quick base + 2 extra; termination: approved)
**Approved by**: user @ 2026-09-04
**Grounded in**: recon.md

---

## Chosen Approach

**Path A done correctly — enforce a per-account drawdown WARNING alert over broker-authoritative
equity.** Recon's original "Path A is cheap" premise was **disproven** (R1): `portfolio.snapshots.equity`
is cashless position mark-to-market (`portfolio_service.go:706`, `cash=0` hardcoded), so drawdown on it
fires false alerts when a user de-risks to cash. The correct basis is `portfolio.account_balances.equity`
(broker cash+positions, synced from Alpaca/IBKR). This is a **medium** change (DB migration + a
balance-sync HWM update + a query + tests + docs), not the one-liner the SEV-3 was first scoped as.

**Grain: per-account** (user decision at the R2 gate). `account_balances` is keyed per account
(`004_account_balances.up.sql:6`); a cross-account SUM would inflate drawdown (sum-of-per-account-peaks
≥ peak-of-summed-equity when accounts peak at different times), reintroducing the false-positive class.
The alert names the offending account. (Diverges from the sibling concentration check's portfolio-wide
grain — recorded here per C-11; the `@AC` is worded to per-account to keep C-15 consistent.)

Concrete changes (all in `xstockstrat-portfolio`; notify/ledger edges already wired):
1. **Migration 016** `016_account_balance_peak_equity.up.sql` (+ `.down.sql`): add
   `peak_equity <same type as equity> NOT NULL DEFAULT 0` to `portfolio.account_balances`; backfill
   `UPDATE portfolio.account_balances SET peak_equity = equity;` (seed peak = current, no reference to
   any other column). Down: `DROP COLUMN peak_equity`. **`peak_equity` must match the `equity` column's
   SQL type** (verify NUMERIC vs DOUBLE PRECISION at `/sdd-spec` from `004_account_balances.up.sql`; use
   the same type so `GREATEST` has no type coercion).
2. **HWM update in the existing balance-sync upsert** (`UpsertAccountBalance`, `portfolio_repo.go:380`):
   add `peak_equity` to the INSERT (= the `equity` arg) and `ON CONFLICT … peak_equity =
   GREATEST(portfolio.account_balances.peak_equity, EXCLUDED.equity)`. **No Go signature change**;
   `processBalanceSync`/`ConsumeBalanceSyncs` (`portfolio_service.go:1022`) untouched — the HWM rises
   automatically at every `account.balance.synced`.
3. **New repo read** `GetAccountDrawdowns(ctx, userID, mode) → []AccountDrawdown{account_id, equity,
   peak_equity}`: `SELECT account_id, equity, peak_equity FROM portfolio.account_balances WHERE
   user_id=$1 AND trading_mode=$2`, on the mockable `r.db` surface (`portfolio_repo.go:28`).
4. **Pure decision seam** `evaluateDrawdowns(rows []AccountDrawdown, limit float64) []string` — returns a
   per-account breach message for each row where `peak_equity > 0 && (peak-current)/peak > limit`. This
   is the seam the `@AC-1` RED test targets (see Tests).
5. **Wire into `checkRiskLimits`** (`portfolio_service.go:750`, replacing `_ = maxDrawdownPct`): fetch
   `GetAccountDrawdowns(ctx, userID, mode.String())`, pass to `evaluateDrawdowns`, and for each returned
   message call the existing `emitRiskAlert(ctx, msg)` (WARNING/"risk"). The thin fetch+emit wiring stays
   untested, matching the pre-existing untested concentration branch (`recon.md`).

**`trading_mode` string contract (pinned, C-01):** the producer writes the literal
`"TRADING_MODE_PAPER"`/`"TRADING_MODE_LIVE"` (`trading.go:2119-2122` = `commonv1 mode.String()`), so
`checkRiskLimits` must pass `mode.String()` for `$2` — it matches, so the flagged "silent no-op" is not
a live hazard. The pgxmock `WithArgs` binds that exact literal. The cross-service string coupling
(portfolio's `WHERE trading_mode=$2` depends on trading's emitted literal, unguarded by any cross-service
test) is recorded in the portfolio findings log.

**Consumer surface (C-14):** the drawdown WARNING reaches the user via `xstockstrat-notify`
(StreamAlerts / Web Push) — the same path the concentration alert uses; no new UI step. Honors notify's
PRESERVE guarantees (severity floor, dedup, best-effort fanout) by reusing `emitRiskAlert` verbatim.

## Rejected Alternatives

- **Path B (document not-implemented)** — rejected by the user in favor of actually enforcing.
- **Drawdown over `snapshots.equity` (cashless)** — rejected (R1): fires false alerts on de-risking to cash.
- **Cross-account SUM aggregate** — rejected (R2): inflates drawdown via cross-account peak-timing skew.
- **Cash-flow-aware basis / deposit-withdrawal netting** — rejected (R3): the platform models **no**
  cash flows anywhere (repo grep for deposit/withdrawal/cashflow/funding → zero code hits; equity is
  broker-synced verbatim; `last_equity` is prior-day close, not a cash delta). Nothing to net against.
- **Cheap "reset HWM on a large equity jump" heuristic** — rejected (R3, How-to-Act #1/#2): needs an
  arbitrary threshold (silent guess) and its failure mode *masks a real drawdown* — strictly worse than
  the false positive it targets, in a risk alert.
- **`evalDrawdown(peak,current)→bool` as the @AC-1 test** — rejected (R2): a new pure bool that never
  reaches the alert emission → vacuous-green (fails-074). The `evaluateDrawdowns→[]string` seam is the
  honest RED target.
- **Repo-interface refactor to test the full emit path** — rejected: `s.repo` is a concrete
  `*PortfolioRepo`; refactoring to an interface drags marketdata/notify into mockability — out of scope.

## Open Risks

- [ ] **Cash-flow contamination (ACCEPTED).** Basis is broker full equity (cash+positions), synced
  verbatim (`trading.go:2152`, `alpaca.go:451` / `ibkr.go:475` → `account_balances.equity`). The platform
  models no deposits/withdrawals, so: a **withdrawal** can raise a false WARNING breach; a **deposit**
  inflates the peak and can mask a later real drawdown. Accepted because (i) alert-not-halt →
  tolerable/self-correcting, (ii) notify dedup (`@AC-5`) bounds repeat noise, (iii) no cash-flow stream
  exists to net against. → **Named follow-up: "model funding events"** (trading emits a cash-movement
  ledger event / field; portfolio nets it from the HWM). Prerequisite: trading must first emit a
  cash-movement signal (does not today, `trading.go:2158`).
- [ ] **`peak_equity` column type** must equal the `equity` column type — pin at `/sdd-spec` from
  `004_account_balances.up.sql`.
- [ ] **Cross-service `trading_mode` string contract** — portfolio's filter depends on trading's literal;
  record in the portfolio findings log; consider a future contract test.
- [ ] **`@AC` scoping** — the new drawdown `@AC` asserts a *trading-loss* drawdown (peak from prior real
  equity, current below it from losses), NOT a deposit/withdrawal path, so the test never blesses the
  contaminated path.
- [ ] Migration 016 needs **DBA + service-owner** approval at PR (root `CLAUDE.md` Approval Flow).

## Constitution Rules Touched

- `C-07` — migration `016_*.up.sql` + `.down.sql`, next free portfolio NNN (015 is last). Honored.
- `F-01` — new migration, never edits an applied one. Honored.
- `C-08` / `P-06` / `C-15` — `@AC-1` is honestly RED-covered by the `evaluateDrawdowns` seam test
  (breach → offending-account message; sub-limit → empty; `peak==0` → skipped) plus a **pgxmock** query
  test asserting the aggregate columns + `user_id`/`trading_mode` filter (fails-074/142 — don't ship an
  untested query). The thin fetch+emit wiring stays untested (concentration precedent).
- `C-16` — no existing portfolio risk `@AC` to regress (net-new territory); Path A honors notify's
  PRESERVE `@AC-4/@AC-5/@AC-7` by reusing `emitRiskAlert` (WARNING/"risk"). A new portfolio `@AC` is
  authored and promoted at launch.
- `C-14` — consumer surface is the existing notify alert path; no new UI step.
- `C-01` — `trading_mode` literal pinned to `trading.go:2119-2122`; no deferred assumption.
- `C-11`/How-to-Act #1 — the per-account-vs-portfolio-wide fork and the cash-flow limitation were both
  surfaced to the user, not silently guessed.
- No Floor (`F-*`) breach in any round.

## Business Rules Touched (C-16)

- PRESERVE `@AC-7` severity gate / `@AC-5` dedup / `@AC-4` best-effort fanout
  (`notify/acceptance/{notify-external-fanout,pwa-notifications}.feature`) — not regressed: `emitRiskAlert`
  emits WARNING/"risk", clearing the floor; dedup stays notify's job (not bypassed).
- New portfolio drawdown `@AC` — net-new guarantee; promoted to the durable portfolio suite at launch.
