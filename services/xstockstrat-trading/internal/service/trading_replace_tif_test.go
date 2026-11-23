package service

// Regression tests for docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md
// (feature 349): ReplaceOrder must refuse a disallowed time-in-force before it claims an intent.

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/repository"
)

func replaceTIFHarness(fb *fakeBroker, brokerType commonv1.BrokerType) *rlFakeHarness {
	h := newRLFakeHarness(fb)
	h.svc.brokers["acct-1"] = brokerPoolEntry{client: fb, brokerType: int32(brokerType), userID: "u-1"}
	return h
}

func replaceRecorder() (*fakeBroker, *[]broker.OrderRequest) {
	var reqs []broker.OrderRequest
	fb := &fakeBroker{replaceOrderFn: func(_ context.Context, _ string, req broker.OrderRequest) (*broker.BrokerOrder, error) {
		reqs = append(reqs, req)
		return &broker.BrokerOrder{BrokerOrderID: "b-1"}, nil
	}}
	return fb, &reqs
}

func replaceTIFReq(tif tradingv1.TimeInForce) *tradingv1.ReplaceOrderRequest {
	return &tradingv1.ReplaceOrderRequest{OrderId: "ord-1", Qty: 7, TimeInForce: tif.Enum()}
}

func storedOrder(h *rlFakeHarness) *tradingv1.Order {
	h.svc.mu.Lock()
	defer h.svc.mu.Unlock()
	return h.svc.orders["ord-1"]
}

func wantInvalidTIF(t *testing.T, err error) {
	t.Helper()
	if grpcstatus.Code(err) != codes.InvalidArgument || !strings.Contains(err.Error(), "time_in_force") {
		t.Fatalf("error = %v, want InvalidArgument naming time_in_force", err)
	}
}

// @AC-1: a replace with a time-in-force the broker does not allow leaves nothing behind.
func TestReplaceOrder_DisallowedTIFLeavesNothing_F349_AC1(t *testing.T) {
	for _, tc := range []struct {
		name       string
		brokerType commonv1.BrokerType
		tif        tradingv1.TimeInForce
	}{
		{"ibkr opg", commonv1.BrokerType_BROKER_TYPE_IBKR, tradingv1.TimeInForce_TIME_IN_FORCE_OPG},
		{"ibkr cls", commonv1.BrokerType_BROKER_TYPE_IBKR, tradingv1.TimeInForce_TIME_IN_FORCE_CLS},
		{"ibkr unspecified", commonv1.BrokerType_BROKER_TYPE_IBKR, tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED},
		{"alpaca unspecified", commonv1.BrokerType_BROKER_TYPE_ALPACA, tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// No replace hook: a broker replace would panic.
			h := replaceTIFHarness(&fakeBroker{}, tc.brokerType)

			_, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), replaceTIFReq(tc.tif))
			wantInvalidTIF(t, err)
			if n := h.intentCount(); n != 0 {
				t.Fatalf("replace intent rows = %d, want none", n)
			}
			if got := storedOrder(h).IntentState; got != tradingv1.IntentState_INTENT_STATE_COMPLETED {
				t.Fatalf("intent state = %v, want unchanged COMPLETED", got)
			}
		})
	}
}

// @AC-2: the caller can correct the time-in-force and retry.
func TestReplaceOrder_CorrectedTIFRetries_F349_AC2(t *testing.T) {
	fb, reqs := replaceRecorder()
	h := replaceTIFHarness(fb, commonv1.BrokerType_BROKER_TYPE_IBKR)
	refused := replaceTIFReq(tradingv1.TimeInForce_TIME_IN_FORCE_OPG)

	_, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), refused)
	wantInvalidTIF(t, err)

	order, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), replaceTIFReq(tradingv1.TimeInForce_TIME_IN_FORCE_DAY))
	if err != nil || len(*reqs) != 1 || order.TimeInForce != tradingv1.TimeInForce_TIME_IN_FORCE_DAY {
		t.Fatalf("corrected replace: order = %+v, err = %v, broker replaces = %d; want one broker replace and DAY", order, err, len(*reqs))
	}
	waitForLedgerEvents(t, h.ledger, 1)

	_, err = h.svc.ReplaceOrder(ctxAsUser("user-1"), refused)
	wantInvalidTIF(t, err)
	if n := h.intentCount(); n != 1 {
		t.Fatalf("replace intent rows = %d, want only the corrected replace's", n)
	}
	if len(*reqs) != 1 {
		t.Fatalf("broker replaces = %d, want still 1", len(*reqs))
	}
}

// @AC-3 (guard, passes before the fix): an allowed replace still claims exactly one intent.
func TestReplaceOrder_AllowedTIFClaimsOneIntent_F349_AC3(t *testing.T) {
	t.Run("identical replay returns the stored result", func(t *testing.T) {
		fb, reqs := replaceRecorder()
		h := replaceTIFHarness(fb, commonv1.BrokerType_BROKER_TYPE_IBKR)
		req := replaceTIFReq(tradingv1.TimeInForce_TIME_IN_FORCE_DAY)

		if _, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), req); err != nil {
			t.Fatalf("replace: %v", err)
		}
		waitForLedgerEvents(t, h.ledger, 1)
		intentID, _, err := deriveReplaceCancelIntentID(req)
		if err != nil {
			t.Fatalf("derive intent id: %v", err)
		}
		if n := h.intentCount(); n != 1 {
			t.Fatalf("replace intent rows = %d, want 1", n)
		}
		if rec, _ := h.intents.GetIntentByID(context.Background(), intentID); rec.State != repository.IntentStateCompleted {
			t.Fatalf("intent state = %d, want COMPLETED", rec.State)
		}
		if len(*reqs) != 1 || (*reqs)[0].TimeInForce != "day" {
			t.Fatalf("broker replaces = %+v, want one with time-in-force \"day\"", *reqs)
		}

		order, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), req)
		if err != nil || order.Qty != 7 || len(*reqs) != 1 || h.intentCount() != 1 {
			t.Fatalf("identical replay: order = %+v, err = %v, broker replaces = %d, intent rows = %d; want the stored result, 1 and 1",
				order, err, len(*reqs), h.intentCount())
		}
	})

	t.Run("a replace without a time-in-force sends none", func(t *testing.T) {
		fb, reqs := replaceRecorder()
		h := replaceTIFHarness(fb, commonv1.BrokerType_BROKER_TYPE_IBKR)

		if _, err := h.svc.ReplaceOrder(ctxAsUser("user-1"), &tradingv1.ReplaceOrderRequest{OrderId: "ord-1", Qty: 7}); err != nil {
			t.Fatalf("replace: %v", err)
		}
		waitForLedgerEvents(t, h.ledger, 1)
		if len(*reqs) != 1 || (*reqs)[0].TimeInForce != "" {
			t.Fatalf("broker replaces = %+v, want one with no time-in-force", *reqs)
		}
		if n := h.intentCount(); n != 1 {
			t.Fatalf("replace intent rows = %d, want 1", n)
		}
	})
}

// @AC-4: a disallowed time-in-force is refused even when an intent for the same request exists.
func TestReplaceOrder_DisallowedTIFBeatsExistingIntent_F349_AC4(t *testing.T) {
	h := replaceTIFHarness(&fakeBroker{}, commonv1.BrokerType_BROKER_TYPE_IBKR)
	req := replaceTIFReq(tradingv1.TimeInForce_TIME_IN_FORCE_OPG)
	intentID, hashHex, err := deriveReplaceCancelIntentID(req)
	if err != nil {
		t.Fatalf("derive intent id: %v", err)
	}
	h.intents.recs[intentID] = &repository.OrderIntentRecord{
		IntentID: intentID, OrderID: "ord-1", RequestHash: hashHex,
		State: repository.IntentStateUnknown, UpdatedAt: time.Now(),
	}

	_, err = h.svc.ReplaceOrder(ctxAsUser("user-1"), req)
	wantInvalidTIF(t, err)
	if n := h.intentCount(); n != 1 {
		t.Fatalf("intent rows = %d, want the seeded row only", n)
	}
	if rec, _ := h.intents.GetIntentByID(context.Background(), intentID); rec.State != repository.IntentStateUnknown {
		t.Fatalf("seeded intent state = %d, want still UNKNOWN", rec.State)
	}
}
