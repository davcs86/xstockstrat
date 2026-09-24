package service

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
)

// ctxAsUser returns a context carrying the given x-user-id, exactly as the gRPC server
// interceptor populates it. It is the test seam for the caller-ownership gates on the
// order/account RPCs (PlaceOrder / CancelOrder / ReplaceOrder / ConfirmOrder).
func ctxAsUser(userID string) context.Context {
	return middleware.WithPropagationData(context.Background(), middleware.PropagationData{UserID: userID})
}

// TestPlaceOrder_RejectsCrossAccount proves C-1: a caller may not place an order on an account
// they do not own. resolveAccount returns the account owner; PlaceOrder refuses a caller mismatch
// with PermissionDenied before any broker submission or offline recording.
func TestPlaceOrder_RejectsCrossAccount(t *testing.T) {
	s := &TradingService{
		cfgW:    &config.Watcher{},
		brokers: map[string]brokerPoolEntry{"acct-owner": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "owner"}},
	}
	_, err := s.PlaceOrder(ctxAsUser("attacker"), &tradingv1.PlaceOrderRequest{
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, Qty: 1,
		ClientOrderId: "nonce-1", AccountId: "acct-owner",
	})
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Errorf("cross-account PlaceOrder: got code %v, want PermissionDenied", grpcstatus.Code(err))
	}
}

// TestPlaceOrder_RejectsMissingCaller proves the fail-closed half of C-1: a request with no
// x-user-id owns nothing and is refused.
func TestPlaceOrder_RejectsMissingCaller(t *testing.T) {
	s := &TradingService{
		cfgW:    &config.Watcher{},
		brokers: map[string]brokerPoolEntry{"acct-owner": {brokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), userID: "owner"}},
	}
	_, err := s.PlaceOrder(context.Background(), &tradingv1.PlaceOrderRequest{
		Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, Qty: 1,
		ClientOrderId: "nonce-1", AccountId: "acct-owner",
	})
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Errorf("PlaceOrder with no caller: got code %v, want PermissionDenied", grpcstatus.Code(err))
	}
}

// TestCancelOrder_RejectsCrossUser proves C-2: a caller may not cancel another user's order.
func TestCancelOrder_RejectsCrossUser(t *testing.T) {
	s := &TradingService{
		cfgW: &config.Watcher{},
		orders: map[string]*tradingv1.Order{
			"ord-1": {OrderId: "ord-1", UserId: "owner", AccountId: "acct-1",
				BrokerType: commonv1.BrokerType_BROKER_TYPE_ALPACA, BrokerOrderId: "brk-1",
				Status: tradingv1.OrderStatus_ORDER_STATUS_NEW},
		},
	}
	_, err := s.CancelOrder(ctxAsUser("attacker"), &tradingv1.CancelOrderRequest{OrderId: "ord-1"})
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Errorf("cross-user CancelOrder: got code %v, want PermissionDenied", grpcstatus.Code(err))
	}
}

// TestReplaceOrder_RejectsCrossUser proves C-2: a caller may not modify another user's order.
func TestReplaceOrder_RejectsCrossUser(t *testing.T) {
	s := &TradingService{
		cfgW: &config.Watcher{},
		orders: map[string]*tradingv1.Order{
			"ord-1": {OrderId: "ord-1", UserId: "owner", AccountId: "acct-1",
				BrokerOrderId: "brk-1", Status: tradingv1.OrderStatus_ORDER_STATUS_NEW},
		},
	}
	_, err := s.ReplaceOrder(ctxAsUser("attacker"), &tradingv1.ReplaceOrderRequest{OrderId: "ord-1", Qty: 5})
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Errorf("cross-user ReplaceOrder: got code %v, want PermissionDenied", grpcstatus.Code(err))
	}
}

// TestSnapshotOfflinePositions_RejectsCrossUser proves H-2: a caller may not overwrite another
// user's offline position baseline. req.UserId is the handler-injected caller (from x-user-id);
// a mismatch with the account owner is refused before the offline-type gate.
func TestSnapshotOfflinePositions_RejectsCrossUser(t *testing.T) {
	s := &TradingService{
		cfgW: &config.Watcher{},
		accountRepo: &offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
			ID: "acct-1", UserID: "owner", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
		}},
	}
	_, err := s.SnapshotOfflinePositions(ctxAsUser("attacker"), snapshotReq(
		"acct-1", "attacker", "snap-x", time.Now(),
		posBaseline("AAPL", 100, 150),
	))
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Errorf("cross-user SnapshotOfflinePositions: got code %v, want PermissionDenied", grpcstatus.Code(err))
	}
}

// TestBroadcastOrder_ScopesToSubscriberUser proves H-1: broadcastOrder delivers a live order
// update only to subscribers whose user filter matches the order owner. A scoped subscriber never
// receives another user's order; the internal all-users selector (userID == "") still gets every.
func TestBroadcastOrder_ScopesToSubscriberUser(t *testing.T) {
	s := &TradingService{subs: make(map[string]orderSubscriber)}
	own := s.SubscribeOrderUpdates("sub-own", "u1")
	other := s.SubscribeOrderUpdates("sub-other", "u2")
	all := s.SubscribeOrderUpdates("sub-all", "")

	s.broadcastOrder(&tradingv1.Order{OrderId: "o1", UserId: "u1"})

	select {
	case got := <-own:
		if got.OrderId != "o1" {
			t.Errorf("owning subscriber: got %q, want o1", got.OrderId)
		}
	default:
		t.Error("owning subscriber (u1) did not receive its own order")
	}

	select {
	case got := <-other:
		t.Errorf("cross-user leak: u2 subscriber received u1's order %q", got.OrderId)
	default:
	}

	select {
	case got := <-all:
		if got.OrderId != "o1" {
			t.Errorf("all-users subscriber: got %q, want o1", got.OrderId)
		}
	default:
		t.Error("all-users selector subscriber did not receive the order")
	}
}
