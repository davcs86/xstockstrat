package service

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// Regression suite for docs/reports/2026-10-02-alpaca-cancel-422-defect.md: a broker
// "not cancelable" answer is resolved from the broker's own order state, never assumed CANCELED.

func notCancelableSvc(fb *fakeBroker, bracket *fakeBracketRepo) (*TradingService, *tradingv1.Order) {
	order := &tradingv1.Order{
		OrderId: "ord-1", UserId: "user-1", AccountId: "acct-1", BrokerOrderId: "brk-order-1",
		Qty: 10, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
	}
	if bracket == nil {
		bracket = &fakeBracketRepo{}
	}
	return &TradingService{
		cfgW: &config.Watcher{}, orderIntentRepo: &fakeOrderIntentRepo{}, bracketRepo: bracket, ledger: &fakeLedgerClient{},
		brokers: map[string]brokerPoolEntry{"acct-1": {client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)}},
		orders:  map[string]*tradingv1.Order{"ord-1": order},
	}, order
}

func notCancelable(context.Context, string) error { return broker.ErrOrderNotCancelable }

func TestCancelOrder_NotCancelable_BrokerFilled_AdoptsFillNotCanceled(t *testing.T) {
	bracket := &fakeBracketRepo{
		byID: map[string]*repository.OrderBracketRecord{
			"brk-1": {ID: "brk-1", OrderID: "ord-1", Status: bracketStatusActive, StopLegOrderID: "leg-stop", TakeProfitLegOrderID: "leg-tp"},
		},
	}
	bracket.byOrder = map[string]*repository.OrderBracketRecord{"ord-1": bracket.byID["brk-1"]}
	fb := &fakeBroker{
		cancelOrderFn: notCancelable,
		getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
			return &broker.BrokerOrder{BrokerOrderID: "brk-order-1", Status: "filled", FilledQty: 10, FilledAvgPrice: 101.5}, nil
		},
	}
	svc, order := notCancelableSvc(fb, bracket)
	func() {
		// s.repo is a concrete *TradingRepo this package cannot fake; its UpsertOrder panics after
		// the status has been adopted (same harness limit as trading_bracket_test.go).
		defer func() { _ = recover() }()
		_, _ = svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	}()

	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_FILLED {
		t.Fatalf("status = %v, want FILLED (pre-fix: CANCELED, fill lost)", order.Status)
	}
	if order.FilledQty != 10 || order.FilledAvgPrice != 101.5 {
		t.Fatalf("fill not adopted: qty=%v price=%v", order.FilledQty, order.FilledAvgPrice)
	}
	fb.mu.Lock()
	defer fb.mu.Unlock()
	if len(fb.cancelOrderCalls) != 1 {
		t.Fatalf("protective bracket legs of a filled order must not be canceled; calls=%v", fb.cancelOrderCalls)
	}
	if rec, _ := bracket.GetBracketByOrderID(context.Background(), "ord-1"); rec.Status != bracketStatusActive {
		t.Fatalf("bracket status = %v, want ACTIVE", rec.Status)
	}
}

func TestCancelOrder_NotCancelable_BrokerCanceled_RecordsCanceled(t *testing.T) {
	fb := &fakeBroker{
		cancelOrderFn: notCancelable,
		getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
			return &broker.BrokerOrder{BrokerOrderID: "brk-order-1", Status: "canceled"}, nil
		},
	}
	svc, order := notCancelableSvc(fb, nil)
	func() {
		defer func() { _ = recover() }()
		_, _ = svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	}()
	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_CANCELED {
		t.Fatalf("status = %v, want CANCELED", order.Status)
	}
	if order.IntentState != tradingv1.IntentState_INTENT_STATE_COMPLETED {
		t.Fatalf("intent = %v, want COMPLETED (broker-confirmed)", order.IntentState)
	}
}

func TestCancelOrder_NotCancelable_ReReadFails_LeavesOrderForPoller(t *testing.T) {
	fb := &fakeBroker{
		cancelOrderFn: notCancelable,
		getOrderFn: func(context.Context, string) (*broker.BrokerOrder, error) {
			return nil, errors.New("broker timeout")
		},
	}
	svc, order := notCancelableSvc(fb, nil)
	_, err := svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	if grpcstatus.Code(err) != codes.Unavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW {
		t.Fatalf("status = %v, want unchanged NEW so pollFills still converges it", order.Status)
	}
	if order.IntentState != tradingv1.IntentState_INTENT_STATE_UNKNOWN {
		t.Fatalf("intent = %v, want UNKNOWN", order.IntentState)
	}
}
