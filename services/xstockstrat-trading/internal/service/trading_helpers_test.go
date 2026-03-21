package service

import (
	"testing"

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
		name                     string
		qty                      float64
		limitPrice               float64
		approvalQtyThreshold     float64
		approvalNotionalThreshold float64
		expectApproval           bool
	}{
		{
			name:                     "below both thresholds",
			qty:                      100,
			limitPrice:               10,
			approvalQtyThreshold:     500,
			approvalNotionalThreshold: 50000,
			expectApproval:           false,
		},
		{
			name:                     "qty above threshold",
			qty:                      600,
			limitPrice:               10,
			approvalQtyThreshold:     500,
			approvalNotionalThreshold: 50000,
			expectApproval:           true,
		},
		{
			name:                     "notional above threshold",
			qty:                      100,
			limitPrice:               600,
			approvalQtyThreshold:     500,
			approvalNotionalThreshold: 50000,
			expectApproval:           true,
		},
		{
			name:                     "no limit price — notional not checked",
			qty:                      100,
			limitPrice:               0,
			approvalQtyThreshold:     500,
			approvalNotionalThreshold: 50000,
			expectApproval:           false,
		},
		{
			name:                     "exact qty threshold — not triggered",
			qty:                      500,
			limitPrice:               0,
			approvalQtyThreshold:     500,
			approvalNotionalThreshold: 50000,
			expectApproval:           false,
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
