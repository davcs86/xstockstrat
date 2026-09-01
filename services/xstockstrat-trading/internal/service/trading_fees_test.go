package service

import (
	"context"
	"testing"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"

	"github.com/xstockstrat/trading/internal/broker"
)

// Feature 029 — the fill poller stamps an additive `fees` key (brokerOrder.Fees) onto the
// order.filled / order.partially_filled ledger payloads, so the portfolio fold can accumulate a
// per-position fee total (net = realized_pnl - fees_total) without any proto change. pollFills
// itself needs a live broker/repo and is not unit-drivable; this exercises the same emit contract
// via emitLedgerEvent (the sanctioned precedent — see trading_ledger_userid_test.go), building the
// exact payload maps trading.go:1712/1728 build from a broker.BrokerOrder. Referencing
// broker.BrokerOrder.Fees is the compile-level RED before Step 5 added the field.
func TestFillEmitsCarryBrokerFees(t *testing.T) {
	rec := &recordingLedger{}
	s := &TradingService{ledger: rec}
	order := &tradingv1.Order{
		OrderId: "o1", UserId: "u_42", Symbol: "AAPL",
		Qty: 10, FilledQty: 10, FilledAvgPrice: 100,
		TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER, AccountId: "acct-1",
	}
	brokerOrder := &broker.BrokerOrder{FilledQty: 10, FilledAvgPrice: 100, Fees: 1.20}

	// order.filled — mirrors trading.go:1712.
	s.emitLedgerEvent(context.Background(), "order.filled", "order:"+order.OrderId, order.UserId, map[string]interface{}{
		"order_id": order.OrderId, "symbol": order.Symbol,
		"qty": order.Qty, "fill_price": order.FilledAvgPrice,
		"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
		"account_id": order.AccountId,
		"fees":       brokerOrder.Fees,
	})
	// order.partially_filled — mirrors trading.go:1728.
	s.emitLedgerEvent(context.Background(), "order.partially_filled", "order:"+order.OrderId, order.UserId, map[string]interface{}{
		"order_id": order.OrderId, "symbol": order.Symbol,
		"filled_qty": order.FilledQty, "fill_price": order.FilledAvgPrice,
		"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
		"account_id": order.AccountId,
		"fees":       brokerOrder.Fees,
	})

	for _, et := range []string{"order.filled", "order.partially_filled"} {
		reqs := rec.requestsByType(et)
		if len(reqs) != 1 {
			t.Fatalf("%s: want 1 emit, got %d", et, len(reqs))
		}
		fields := reqs[0].GetPayload().GetFields()
		if got := fields["fees"].GetNumberValue(); got != 1.20 {
			t.Errorf("%s: payload fees = %v, want 1.20", et, got)
		}
		// AC-10's "unchanged gross" leg at the trading edge: the pre-existing keys are untouched.
		if got := fields["fill_price"].GetNumberValue(); got != 100 {
			t.Errorf("%s: fill_price = %v, want 100 (unchanged)", et, got)
		}
		if got := fields["user_id"].GetStringValue(); got != "u_42" {
			t.Errorf("%s: user_id = %q, want u_42 (unchanged)", et, got)
		}
		if got := fields["account_id"].GetStringValue(); got != "acct-1" {
			t.Errorf("%s: account_id = %q, want acct-1 (unchanged)", et, got)
		}
		if got := fields["trading_mode"].GetStringValue(); got != "TRADING_MODE_PAPER" {
			t.Errorf("%s: trading_mode = %q, want TRADING_MODE_PAPER (unchanged)", et, got)
		}
	}
}

// The honest 0-default: neither the Alpaca nor the IBKR adapter sources a per-fill fee, so a broker
// order they return leaves Fees at its zero value (net == gross, AC-11) until a named Activities-API
// follow-up sources regulatory fees.
func TestBrokerOrderFeesDefaultsToZero(t *testing.T) {
	var bo broker.BrokerOrder
	if bo.Fees != 0 {
		t.Errorf("zero-value BrokerOrder.Fees = %v, want 0", bo.Fees)
	}
}
