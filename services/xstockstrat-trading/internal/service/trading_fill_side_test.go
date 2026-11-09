package service

import (
	"context"
	"testing"
	"time"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
)

// Feature 251 AC-10 (and durable platform @AC-10 @feature-029: fees kept): fill events carry the
// order side, the canonical source service and the order id as stream key.
func TestFillEmit251_AC10_CarriesSideSourceAndFees(t *testing.T) {
	rows := []struct {
		name      string
		status    string
		filledQty float64
		eventType string
		qtyKey    string
	}{
		{"filled", "filled", 10, "order.filled", "qty"},
		{"partially_filled", "partially_filled", 4, "order.partially_filled", "filled_qty"},
	}
	for _, tc := range rows {
		t.Run(tc.name, func(t *testing.T) {
			fb := &fakeBroker{
				cancelOrderFn: notCancelable,
				getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
					return &broker.BrokerOrder{BrokerOrderID: "brk-order-1", Status: tc.status, FilledQty: tc.filledQty, FilledAvgPrice: 101.5}, nil
				},
			}
			svc, order := notCancelableSvc(fb, nil)
			order.Side = tradingv1.OrderSide_ORDER_SIDE_SELL
			order.Symbol = "AAPL"
			rec := &recordingLedger{}
			svc.ledger = rec

			if _, err := svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"}); err != nil {
				t.Fatalf("CancelOrder: %v", err)
			}
			var reqs []*ledgerv1.AppendEventRequest
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if reqs = rec.requestsByType(tc.eventType); len(reqs) > 0 {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			if len(reqs) != 1 {
				t.Fatalf("%s events = %d, want 1", tc.eventType, len(reqs))
			}
			req := reqs[0]
			if req.SourceService != "xstockstrat-trading" {
				t.Fatalf("SourceService = %q, want xstockstrat-trading", req.SourceService)
			}
			if req.StreamKey != "ord-1" {
				t.Fatalf("StreamKey = %q, want ord-1", req.StreamKey)
			}
			f := req.Payload.GetFields()
			if got := f["side"].GetStringValue(); got != tradingv1.OrderSide_ORDER_SIDE_SELL.String() {
				t.Fatalf("payload side = %q, want %s", got, tradingv1.OrderSide_ORDER_SIDE_SELL)
			}
			if got := f[tc.qtyKey].GetNumberValue(); got != tc.filledQty {
				t.Fatalf("payload %s = %v, want %v (unsigned)", tc.qtyKey, got, tc.filledQty)
			}
			if _, ok := f["fees"]; !ok {
				t.Fatalf("payload missing fees key")
			}
		})
	}
}
