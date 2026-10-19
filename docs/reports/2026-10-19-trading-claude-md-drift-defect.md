# Defect: trading CLAUDE.md drift (approval runbook, ledger events, halt resume, retry scope) plus a portfolio cross-cite

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: `services/xstockstrat-trading/docs/context-constitution-findings.md` § Documentation that lies, rows 1, 2, 3, 5, 6; trading CLAUDE.md § Approval Flow (found during verification)

## Observed
1. **Dangling approval runbook.** § Approval Flow says approval-required orders "do not proceed to
   broker until approved" and links `_tasks/x-approval-flow.md`. That file does not exist, and no
   Approve RPC or emit site exists, so `PENDING_APPROVAL` is a dead end.
2. **Ledger events table incomplete.** `account.halt.resumed`, `order_intent.reclaimed_unknown` and
   `order_intent.late_response_conflict` are emitted but not listed.
3. **Halt resume described as a manual DB edit.** § Broker State Reconciliation says nothing clears a
   halt. In fact the admin-gated `ResumeAccount` RPC (`ResumeAccountSvc`) does.
4. **`max_retries` scope overstated.** § Idempotency and the Config Keys table describe broker-submission
   retries. `submitOrder` calls the broker once; only `flattenAndHalt` reads these keys.
5. **Portfolio cross-cite stale.** Portfolio CLAUDE.md cites the trading findings `:14` for the
   `platform.ledger_endpoint` row. Line 14 is now the `max_retries` row; the ledger_endpoint entry
   moved to § Resolved.

## Expected
The docs match the code: the dangling link is removed and the missing approval path is stated, the
three events are listed, `ResumeAccount` is documented, `max_retries` is scoped to the
emergency-flatten loop, and citations use symbols or anchors rather than line numbers.

## Reproduction
1. Read `services/xstockstrat-trading/CLAUDE.md:134`, then run `ls _tasks/x-approval-flow.md` (ENOENT).
2. Compare the CLAUDE.md Ledger Events table (L138-156) with the emit sites below.
3. Read `CLAUDE.md:227`, then compare it with `ResumeAccountSvc` in `trading.go`.
4. Read `CLAUDE.md:17` and `:94`, then compare them with `trading.go:681` (the single submit) and `:2748`.
5. Read `services/xstockstrat-portfolio/CLAUDE.md:98`, then open trading findings line 14.

## Evidence
`services/xstockstrat-trading/CLAUDE.md:134`
> See `_tasks/x-approval-flow.md` for the full runbook.

`services/xstockstrat-trading/internal/service/trading.go:2973`
> s.emitLedgerEvent(ctx, "account.halt.resumed", fmt.Sprintf("account:%s", accountID), callerUserID, map[string]interface{}{

`services/xstockstrat-trading/internal/service/order_intent.go:152`
> s.emitLedgerEvent(ctx, "order_intent.reclaimed_unknown", fmt.Sprintf("order:%s", out.OrderID), "", map[string]interface{}{

`services/xstockstrat-trading/internal/service/trading.go:2142`
> EventType: "order_intent.late_response_conflict",

`services/xstockstrat-trading/CLAUDE.md:227`
> ever clears a halt (resuming is a manual DB edit), so a later finding against an already-halted

`services/xstockstrat-trading/CLAUDE.md:17`
> so a retried submission (`trading.order.max_retries`) is de-duplicated by the broker

`services/xstockstrat-trading/internal/service/trading.go:681`
> brokerOrder, err := accountEntry.client.SubmitOrder(ctx, brokerReq)

`services/xstockstrat-portfolio/CLAUDE.md:98`
> (`docs/context-constitution-findings.md:14`), which flagged the same stale row.

## Root cause hypothesis
Features 101, 102 and 169 shipped without updating CLAUDE.md. The approval section describes a flow
that was planned but never built. Line-number cross-citations went stale as the findings file grew.

## Confidence
high
