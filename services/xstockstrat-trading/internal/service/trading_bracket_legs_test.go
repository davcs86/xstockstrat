package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/repository"
)

// legRow returns a copy of the fake's bracket_legs row, or nil when none exists.
func legRow(f *fakeBracketRepo, accountID, legID string) *repository.BracketLegRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	leg, ok := f.legs[fakeLegKey(accountID, legID)]
	if !ok {
		return nil
	}
	cp := *leg
	return &cp
}

func legCount(f *fakeBracketRepo) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.legs)
}

func newLegTestOrder(id string, side tradingv1.OrderSide, brokerType commonv1.BrokerType) *tradingv1.Order {
	order := newTestBracketOrder(id, side, brokerType)
	order.UserId = "user-1"
	return order
}

// assertActivatedLeg checks a leg row ActivateBracket wrote: zero cursors, OPEN, not adopted,
// the parent's identity and the side that closes the entry.
func assertActivatedLeg(t *testing.T, f *fakeBracketRepo, order *tradingv1.Order, legID string, wantSide tradingv1.OrderSide) {
	t.Helper()
	got := legRow(f, order.AccountId, legID)
	want := repository.BracketLegRecord{
		AccountID: order.AccountId, LegOrderID: legID, OrderID: order.OrderId, UserID: order.UserId,
		TradingMode: order.TradingMode.String(), Symbol: order.Symbol, Side: wantSide, Status: repository.LegStatusOpen,
	}
	if got == nil || *got != want {
		t.Errorf("leg %s = %+v, want %+v", legID, got, want)
	}
}

func ibkrLegsBroker(stopID, takeProfitID string) *fakeBroker {
	return &fakeBroker{submitBracketLegsFn: func(context.Context, string, string, broker.BracketLegsRequest) (*broker.BracketLegsResponse, error) {
		return &broker.BracketLegsResponse{StopLegOrderID: stopID, TakeProfitLegOrderID: takeProfitID}, nil
	}}
}

var entrySides = []struct {
	name     string
	entry    tradingv1.OrderSide
	wantLegs tradingv1.OrderSide
}{
	{"long entry", tradingv1.OrderSide_ORDER_SIDE_BUY, tradingv1.OrderSide_ORDER_SIDE_SELL},
	{"short entry", tradingv1.OrderSide_ORDER_SIDE_SELL, tradingv1.OrderSide_ORDER_SIDE_BUY},
}

func TestActivateBracket_AlpacaWritesBothLegRows(t *testing.T) {
	for _, tc := range entrySides {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeBracketRepo{}
			svc := newTestBracketService(repo, &fakeNotifyClient{})
			order := newLegTestOrder("ord-legs-alpaca", tc.entry, commonv1.BrokerType_BROKER_TYPE_ALPACA)
			entry := brokerPoolEntry{client: &fakeBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)}
			brokerOrder := &broker.BrokerOrder{StopLegOrderID: "leg-stop-1", TakeProfitLegOrderID: "leg-tp-1"}

			svc.maybeSubmitBracket(context.Background(), order, entry, brokerOrder, 145.0, 148.0, true)

			if n := legCount(repo); n != 2 {
				t.Fatalf("leg rows = %d, want 2", n)
			}
			assertActivatedLeg(t, repo, order, "leg-stop-1", tc.wantLegs)
			assertActivatedLeg(t, repo, order, "leg-tp-1", tc.wantLegs)
		})
	}
}

func TestActivateBracket_IBKRWritesLegRows(t *testing.T) {
	for _, tc := range entrySides {
		t.Run(tc.name, func(t *testing.T) {
			repo := &fakeBracketRepo{}
			svc := newTestBracketService(repo, &fakeNotifyClient{})
			order := newLegTestOrder("ord-legs-ibkr", tc.entry, commonv1.BrokerType_BROKER_TYPE_IBKR)
			entry := brokerPoolEntry{client: ibkrLegsBroker("s1", "t1"), brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}

			svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

			if n := legCount(repo); n != 2 {
				t.Fatalf("leg rows = %d, want 2", n)
			}
			assertActivatedLeg(t, repo, order, "s1", tc.wantLegs)
			assertActivatedLeg(t, repo, order, "t1", tc.wantLegs)
		})
	}
}

func TestActivateBracket_IBKRWithoutTakeProfitWritesOneRow(t *testing.T) {
	repo := &fakeBracketRepo{}
	svc := newTestBracketService(repo, &fakeNotifyClient{})
	order := newLegTestOrder("ord-legs-stop-only", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_IBKR)
	entry := brokerPoolEntry{client: ibkrLegsBroker("s1", ""), brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}

	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

	if n := legCount(repo); n != 1 {
		t.Fatalf("leg rows = %d, want 1", n)
	}
	assertActivatedLeg(t, repo, order, "s1", tradingv1.OrderSide_ORDER_SIDE_SELL)
}

// TestActivateBracket_ResizeAddsNewLegRowsAndKeepsOld: the resubmitted legs get rows; the canceled
// legs' rows stay (their late fills must still be observable).
func TestActivateBracket_ResizeAddsNewLegRowsAndKeepsOld(t *testing.T) {
	repo := &fakeBracketRepo{}
	svc := newTestBracketService(repo, &fakeNotifyClient{})
	order := newLegTestOrder("ord-legs-resize", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_IBKR)
	submits := 0
	fb := &fakeBroker{submitBracketLegsFn: func(context.Context, string, string, broker.BracketLegsRequest) (*broker.BracketLegsResponse, error) {
		submits++
		if submits == 1 {
			return &broker.BracketLegsResponse{StopLegOrderID: "s1", TakeProfitLegOrderID: "t1"}, nil
		}
		return &broker.BracketLegsResponse{StopLegOrderID: "s2", TakeProfitLegOrderID: "t2"}, nil
	}}
	entry := brokerPoolEntry{client: fb, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}

	order.FilledQty = 4
	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)
	order.FilledQty = 9
	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

	if n := legCount(repo); n != 4 {
		t.Fatalf("leg rows = %d, want 4 (s1, t1, s2, t2)", n)
	}
	for _, legID := range []string{"s1", "t1", "s2", "t2"} {
		assertActivatedLeg(t, repo, order, legID, tradingv1.OrderSide_ORDER_SIDE_SELL)
	}
}

func assertOneActivationAlert(t *testing.T, notify *fakeNotifyClient, cause string) {
	t.Helper()
	waitForAlert(t, notify)
	notify.mu.Lock()
	defer notify.mu.Unlock()
	if len(notify.calls) != 1 || notify.calls[0].Severity != notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL {
		t.Fatalf("expected 1 CRITICAL alert, got %+v", notify.calls)
	}
	if !strings.Contains(notify.calls[0].Body, cause) {
		t.Errorf("alert body %q does not name the cause %q", notify.calls[0].Body, cause)
	}
}

func TestActivateBracket_FailureAlertsAtAlpacaSite(t *testing.T) {
	repo := &fakeBracketRepo{activateErr: errors.New("activate tx failed")}
	notify := &fakeNotifyClient{}
	svc := newTestBracketService(repo, notify)
	order := newLegTestOrder("ord-act-fail-alpaca", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_ALPACA)
	entry := brokerPoolEntry{client: &fakeBroker{}, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA)}

	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{StopLegOrderID: "leg-stop-1"}, 145.0, 148.0, true)

	assertOneActivationAlert(t, notify, "activate tx failed")
}

func TestActivateBracket_FailureAlertsAtIBKRCreateSite(t *testing.T) {
	repo := &fakeBracketRepo{activateErr: errors.New("activate tx failed")}
	notify := &fakeNotifyClient{}
	svc := newTestBracketService(repo, notify)
	order := newLegTestOrder("ord-act-fail-ibkr", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_IBKR)
	entry := brokerPoolEntry{client: ibkrLegsBroker("s1", "t1"), brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}

	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

	assertOneActivationAlert(t, notify, "activate tx failed")
}

// TestActivateBracket_FailureAlertsAtResizeSiteAndStillEmits: the resize path alerts and does not
// return early, so its order.bracket_updated emit still happens.
func TestActivateBracket_FailureAlertsAtResizeSiteAndStillEmits(t *testing.T) {
	repo := &fakeBracketRepo{}
	notify := &fakeNotifyClient{}
	ledger := &recordingLedger{}
	svc := newTestBracketService(repo, notify)
	svc.ledger = ledger
	order := newLegTestOrder("ord-act-fail-resize", tradingv1.OrderSide_ORDER_SIDE_BUY, commonv1.BrokerType_BROKER_TYPE_IBKR)
	entry := brokerPoolEntry{client: ibkrLegsBroker("s1", "t1"), brokerType: int32(commonv1.BrokerType_BROKER_TYPE_IBKR)}

	order.FilledQty = 4
	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)
	waitForBracketUpdates(t, ledger, 1)

	repo.mu.Lock()
	repo.activateErr = errors.New("activate tx failed")
	repo.mu.Unlock()
	order.FilledQty = 9
	svc.maybeSubmitBracket(context.Background(), order, entry, &broker.BrokerOrder{}, 145.0, 148.0, true)

	assertOneActivationAlert(t, notify, "activate tx failed")
	waitForBracketUpdates(t, ledger, 2)
}

func waitForBracketUpdates(t *testing.T, ledger *recordingLedger, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(ledger.requestsByType("order.bracket_updated")) >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("order.bracket_updated emits = %d, want %d", len(ledger.requestsByType("order.bracket_updated")), want)
}
