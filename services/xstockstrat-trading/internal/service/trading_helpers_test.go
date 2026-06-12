package service

import (
	"testing"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

func TestAlpacaStatusToProto(t *testing.T) {
	tests := []struct {
		alpacaStatus string
		want         tradingv1.OrderStatus
	}{
		{"new", tradingv1.OrderStatus_ORDER_STATUS_NEW},
		{"partially_filled", tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED},
		{"filled", tradingv1.OrderStatus_ORDER_STATUS_FILLED},
		{"canceled", tradingv1.OrderStatus_ORDER_STATUS_CANCELED},
		{"expired", tradingv1.OrderStatus_ORDER_STATUS_EXPIRED},
		{"rejected", tradingv1.OrderStatus_ORDER_STATUS_REJECTED},
		{"pending_new", tradingv1.OrderStatus_ORDER_STATUS_NEW},
		{"accepted", tradingv1.OrderStatus_ORDER_STATUS_NEW},
		{"unknown_status", tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED},
	}

	for _, tt := range tests {
		t.Run(tt.alpacaStatus, func(t *testing.T) {
			got := alpacaStatusToProto(tt.alpacaStatus)
			if got != tt.want {
				t.Errorf("alpacaStatusToProto(%q) = %v, want %v", tt.alpacaStatus, got, tt.want)
			}
		})
	}
}

func TestApprovalThresholdLogic(t *testing.T) {
	tests := []struct {
		name                      string
		qty                       float64
		limitPrice                float64
		approvalQtyThreshold      float64
		approvalNotionalThreshold float64
		expectApproval            bool
	}{
		{
			name:                      "below both thresholds",
			qty:                       100,
			limitPrice:                10,
			approvalQtyThreshold:      500,
			approvalNotionalThreshold: 50000,
			expectApproval:            false,
		},
		{
			name:                      "qty above threshold",
			qty:                       600,
			limitPrice:                10,
			approvalQtyThreshold:      500,
			approvalNotionalThreshold: 50000,
			expectApproval:            true,
		},
		{
			name:                      "notional above threshold",
			qty:                       100,
			limitPrice:                600,
			approvalQtyThreshold:      500,
			approvalNotionalThreshold: 50000,
			expectApproval:            true,
		},
		{
			name:                      "no limit price — notional not checked",
			qty:                       100,
			limitPrice:                0,
			approvalQtyThreshold:      500,
			approvalNotionalThreshold: 50000,
			expectApproval:            false,
		},
		{
			name:                      "exact qty threshold — not triggered",
			qty:                       500,
			limitPrice:                0,
			approvalQtyThreshold:      500,
			approvalNotionalThreshold: 50000,
			expectApproval:            false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Replicate the approval logic from PlaceOrder.
			requiresApproval := tt.qty > tt.approvalQtyThreshold ||
				(tt.limitPrice > 0 && tt.qty*tt.limitPrice > tt.approvalNotionalThreshold)

			if requiresApproval != tt.expectApproval {
				t.Errorf("approval=%v, want %v (qty=%.0f, limitPrice=%.0f, qtyThresh=%.0f, notionalThresh=%.0f)",
					requiresApproval, tt.expectApproval, tt.qty, tt.limitPrice,
					tt.approvalQtyThreshold, tt.approvalNotionalThreshold)
			}
		})
	}
}

// TestReplaceableStateGate replicates the FR-8 fill-state gate from ReplaceOrder:
// only NEW and PARTIALLY_FILLED orders may be replaced; everything else (including
// the full-fill case and terminal states) is rejected.
func TestReplaceableStateGate(t *testing.T) {
	replaceable := func(s tradingv1.OrderStatus) bool {
		switch s {
		case tradingv1.OrderStatus_ORDER_STATUS_NEW, tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
			return true
		default:
			return false
		}
	}
	tests := []struct {
		name   string
		status tradingv1.OrderStatus
		want   bool
	}{
		{"new allowed", tradingv1.OrderStatus_ORDER_STATUS_NEW, true},
		{"partially_filled allowed", tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED, true},
		{"filled rejected", tradingv1.OrderStatus_ORDER_STATUS_FILLED, false},
		{"canceled rejected", tradingv1.OrderStatus_ORDER_STATUS_CANCELED, false},
		{"expired rejected", tradingv1.OrderStatus_ORDER_STATUS_EXPIRED, false},
		{"rejected rejected", tradingv1.OrderStatus_ORDER_STATUS_REJECTED, false},
		{"pending_approval rejected", tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := replaceable(tt.status); got != tt.want {
				t.Errorf("replaceable(%v) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}

// TestListOrdersInMemoryFilters replicates the in-memory fallback filter predicate
// from ListOrders, asserting each new dimension (symbol/side/order_type/account_id)
// narrows the result set and composes with status/trading_mode.
func TestListOrdersInMemoryFilters(t *testing.T) {
	matches := func(o *tradingv1.Order, req *tradingv1.ListOrdersRequest) bool {
		if req.UserId != "" && o.UserId != req.UserId {
			return false
		}
		if req.Status != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED && o.Status != req.Status {
			return false
		}
		if req.Symbol != "" && o.Symbol != req.Symbol {
			return false
		}
		if req.Side != tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED && o.Side != req.Side {
			return false
		}
		if req.OrderType != tradingv1.OrderType_ORDER_TYPE_UNSPECIFIED && o.OrderType != req.OrderType {
			return false
		}
		if req.AccountId != "" && o.AccountId != req.AccountId {
			return false
		}
		return true
	}

	orders := []*tradingv1.Order{
		{OrderId: "1", UserId: "u1", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, OrderType: tradingv1.OrderType_ORDER_TYPE_LIMIT, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, AccountId: "acct-a"},
		{OrderId: "2", UserId: "u1", Symbol: "AAPL", Side: tradingv1.OrderSide_ORDER_SIDE_SELL, OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET, Status: tradingv1.OrderStatus_ORDER_STATUS_FILLED, AccountId: "acct-a"},
		{OrderId: "3", UserId: "u1", Symbol: "MSFT", Side: tradingv1.OrderSide_ORDER_SIDE_BUY, OrderType: tradingv1.OrderType_ORDER_TYPE_LIMIT, Status: tradingv1.OrderStatus_ORDER_STATUS_NEW, AccountId: "acct-b"},
	}

	count := func(req *tradingv1.ListOrdersRequest) int {
		n := 0
		for _, o := range orders {
			if matches(o, req) {
				n++
			}
		}
		return n
	}

	if got := count(&tradingv1.ListOrdersRequest{Symbol: "AAPL"}); got != 2 {
		t.Errorf("symbol=AAPL: got %d, want 2", got)
	}
	if got := count(&tradingv1.ListOrdersRequest{Side: tradingv1.OrderSide_ORDER_SIDE_BUY}); got != 2 {
		t.Errorf("side=BUY: got %d, want 2", got)
	}
	if got := count(&tradingv1.ListOrdersRequest{OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET}); got != 1 {
		t.Errorf("type=MARKET: got %d, want 1", got)
	}
	if got := count(&tradingv1.ListOrdersRequest{AccountId: "acct-b"}); got != 1 {
		t.Errorf("account=acct-b: got %d, want 1", got)
	}
	// Composition: symbol AAPL + side BUY + status NEW → only order 1.
	composed := &tradingv1.ListOrdersRequest{
		Symbol: "AAPL",
		Side:   tradingv1.OrderSide_ORDER_SIDE_BUY,
		Status: tradingv1.OrderStatus_ORDER_STATUS_NEW,
	}
	if got := count(composed); got != 1 {
		t.Errorf("composed AAPL+BUY+NEW: got %d, want 1", got)
	}
}

// TestPaginateOrders exercises the real service-layer pagination helper.
func TestPaginateOrders(t *testing.T) {
	mk := func(n int) []*tradingv1.Order {
		out := make([]*tradingv1.Order, n)
		for i := range out {
			out[i] = &tradingv1.Order{OrderId: string(rune('a' + i))}
		}
		return out
	}
	all := mk(5)

	// No page request → full slice, total count set, no next token.
	page, resp := paginateOrders(all, nil)
	if len(page) != 5 || resp.TotalCount != 5 || resp.NextPageToken != "" {
		t.Errorf("nil page: got len=%d total=%d next=%q", len(page), resp.TotalCount, resp.NextPageToken)
	}

	// First page of 2 → 2 rows, next token "2", total 5.
	page, resp = paginateOrders(all, &commonv1.PageRequest{PageSize: 2})
	if len(page) != 2 || resp.NextPageToken != "2" || resp.TotalCount != 5 {
		t.Errorf("page1: got len=%d next=%q total=%d", len(page), resp.NextPageToken, resp.TotalCount)
	}

	// Last partial page → remaining row, no next token.
	page, resp = paginateOrders(all, &commonv1.PageRequest{PageSize: 2, PageToken: "4"})
	if len(page) != 1 || resp.NextPageToken != "" {
		t.Errorf("last page: got len=%d next=%q", len(page), resp.NextPageToken)
	}

	// Offset beyond end → empty page.
	page, _ = paginateOrders(all, &commonv1.PageRequest{PageSize: 2, PageToken: "99"})
	if len(page) != 0 {
		t.Errorf("offset beyond end: got len=%d, want 0", len(page))
	}
}
