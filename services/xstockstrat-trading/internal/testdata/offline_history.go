package testdata

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// S1 history — the shared Background of feature 230 @AC-43..@AC-47: three confirmed offline AAPL
// orders on "acc-1" (no fees) plus snapshot "S1" (as_of 2026-10-31T23:59:59Z, AAPL 60 @ 150).
const (
	S1AccountID  = "acc-1"
	S1UserID     = "user-1"
	S1BuyID      = "ord-b1"
	S1SellID     = "ord-s1"
	S2SellID     = "ord-s2"
	S1SnapshotID = "S1"
)

// S1HistoryOrders returns fresh copies of the three confirmed (FILLED) offline orders.
func S1HistoryOrders() []*tradingv1.Order {
	fill := func(id string, side tradingv1.OrderSide, qty, price float64, at string) *tradingv1.Order {
		t, _ := time.Parse(time.RFC3339, at)
		return &tradingv1.Order{
			OrderId: id, ClientOrderId: "client-" + id, Symbol: "AAPL", Side: side,
			OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET, Status: tradingv1.OrderStatus_ORDER_STATUS_FILLED,
			Qty: qty, FilledQty: qty, FilledAvgPrice: price,
			TimeInForce: tradingv1.TimeInForce_TIME_IN_FORCE_DAY, UserId: S1UserID,
			TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER, AccountId: S1AccountID,
			BrokerType: commonv1.BrokerType_BROKER_TYPE_OFFLINE,
			CreatedAt:  timestamppb.New(t.Add(-time.Hour)), UpdatedAt: timestamppb.New(t),
			FilledAt: timestamppb.New(t),
		}
	}
	return []*tradingv1.Order{
		fill(S1BuyID, tradingv1.OrderSide_ORDER_SIDE_BUY, 100, 150, "2026-10-01T15:00:00Z"),
		fill(S1SellID, tradingv1.OrderSide_ORDER_SIDE_SELL, 40, 165, "2026-10-20T15:00:00Z"),
		fill(S2SellID, tradingv1.OrderSide_ORDER_SIDE_SELL, 20, 155, "2026-11-05T15:00:00Z"),
	}
}

// S1Snapshot returns snapshot S1's as_of and its single row (AAPL 60 @ 150).
func S1Snapshot() (time.Time, []*tradingv1.PositionBaseline) {
	return time.Date(2026, 10, 31, 23, 59, 59, 0, time.UTC),
		[]*tradingv1.PositionBaseline{{Symbol: "AAPL", Qty: 60, AvgCostPerShare: 150}}
}
