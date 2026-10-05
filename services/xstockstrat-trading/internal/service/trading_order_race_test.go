package service

import (
	"context"
	"sync"
	"testing"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
)

// Regression for docs/reports/2026-10-03-trading-order-pointer-data-race-defect.md: CancelOrder,
// pollFills and ListOrders on the same order must not race. Only meaningful under `go test -race`.
func TestOrderWriters_ConcurrentCancelPollList_NoDataRace(t *testing.T) {
	fb := &fakeBroker{
		getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
			return &broker.BrokerOrder{BrokerOrderID: "brk-order-1", Status: "partially_filled", FilledQty: 3, FilledAvgPrice: 100}, nil
		},
	}
	svc, _ := notCancelableSvc(fb, nil)

	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		_, _ = svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	}()
	go func() {
		defer wg.Done()
		svc.pollFills(context.Background())
	}()
	go func() {
		defer wg.Done()
		if o, err := svc.GetOrder(context.Background(), &tradingv1.GetOrderRequest{OrderId: "ord-1"}); err == nil {
			_ = o.String() // reads every field, as gRPC marshalling would
		}
	}()
	wg.Wait()

	svc.mu.Lock()
	final := svc.orders["ord-1"]
	svc.mu.Unlock()
	if final.Status != tradingv1.OrderStatus_ORDER_STATUS_CANCELED && final.Status != tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED {
		t.Fatalf("final status = %v, want CANCELED or PARTIALLY_FILLED", final.Status)
	}
}
