package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// Regression suite for docs/reports/2026-10-02-alpaca-cancel-422-defect.md (pruned 2026-10-05; git
// show 2ce8de0a:<path>): a broker "not cancelable" answer is resolved from the broker's own order
// state, never assumed CANCELED.

func notCancelableSvc(fb *fakeBroker, bracket *fakeBracketRepo) (*TradingService, *tradingv1.Order) {
	order := &tradingv1.Order{
		OrderId: "ord-1", UserId: "user-1", AccountId: "acct-1", BrokerOrderId: "brk-order-1",
		Qty: 10, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
	}
	if bracket == nil {
		bracket = &fakeBracketRepo{}
	}
	return &TradingService{
		cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, repo: repository.NewTradingRepoWithDB(execOnlyDB{}), orderIntentRepo: &fakeOrderIntentRepo{}, bracketRepo: bracket, ledger: &fakeLedgerClient{}, notify: &fakeNotifyClient{},
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
	svc, _ := notCancelableSvc(fb, bracket)
	resp, err := svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	if err != nil || resp.Success {
		t.Fatalf("resp=%+v err=%v, want Success=false (the order filled, it was not canceled)", resp, err)
	}

	order := svc.orders["ord-1"]
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
	svc, _ := notCancelableSvc(fb, nil)
	if resp, err := svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"}); err != nil || !resp.Success {
		t.Fatalf("resp=%+v err=%v, want Success=true", resp, err)
	}
	order := svc.orders["ord-1"]
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
	svc, _ := notCancelableSvc(fb, nil)
	_, err := svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	if grpcstatus.Code(err) != codes.Unavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
	order := svc.orders["ord-1"]
	if order.Status != tradingv1.OrderStatus_ORDER_STATUS_NEW {
		t.Fatalf("status = %v, want unchanged NEW so pollFills still converges it", order.Status)
	}
	if order.IntentState != tradingv1.IntentState_INTENT_STATE_UNKNOWN {
		t.Fatalf("intent = %v, want UNKNOWN", order.IntentState)
	}
}

// Feature 347 @AC-36: the not-cancelable re-read is bounded by one broker timeout (a guard until the
// trading client retries: with a single-attempt client the 429 already fails the re-read at once).
func TestCancelOrder_NotCancelableReReadIsBounded_F347_AC36(t *testing.T) {
	h := newRateLimitHarness(t, 5000, rlWorkingOrder(tradingv1.OrderStatus_ORDER_STATUS_NEW), func(_ int, w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}
		rlResetHeader(w, 10*time.Second)
		w.WriteHeader(http.StatusTooManyRequests)
	})
	began := time.Now()
	_, err := h.svc.CancelOrder(ctxAsUser("user-1"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	if took := time.Since(began); took > time.Second {
		t.Fatalf("CancelOrder took %v, want within 1 s", took)
	}
	if grpcstatus.Code(err) != codes.Unavailable || !strings.Contains(err.Error(), "could not be read") {
		t.Fatalf("error = %v, want Unavailable containing \"could not be read\"", err)
	}
	if n := len(h.seen(http.MethodGet, "/v2/orders/b-1")); n != 1 {
		t.Fatalf("GET /v2/orders/b-1 requests = %d, want exactly 1", n)
	}
	order := h.order("ord-1")
	if order.IntentState != tradingv1.IntentState_INTENT_STATE_UNKNOWN || order.Status == tradingv1.OrderStatus_ORDER_STATUS_CANCELED {
		t.Fatalf("order = %v / %v, want intent state UNKNOWN and not CANCELED", order.Status, order.IntentState)
	}
}
