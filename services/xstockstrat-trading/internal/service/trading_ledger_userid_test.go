package service

import (
	"context"
	"testing"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// Feature 021 — the trading producer stamps the owning user_id onto its ledger emits so the
// ledger persists AppendEventRequest.UserId (fills are emitted from background pollers with no
// inbound x-user-id, so pure server-side stamping would leave every fill NULL — AC-8/AC-11).
//
// This directly exercises the fill emit path (the spec's sanctioned "or directly calls" option):
// the poller's order.filled / order.partially_filled cases pass order.UserId, and genuinely
// platform-scoped emits pass "".
func TestEmitLedgerEventStampsOwningUserId(t *testing.T) {
	rec := &recordingLedger{}
	s := &TradingService{ledger: rec}
	order := &tradingv1.Order{OrderId: "o1", UserId: "u_42", Symbol: "AAPL"}

	// User-owned fill emits carry the owner (mirrors trading.go pollFills:order.filled/partially_filled).
	s.emitLedgerEvent(context.Background(), "order.filled", "order:"+order.OrderId, order.UserId, map[string]interface{}{
		"order_id": order.OrderId, "user_id": order.UserId,
	})
	s.emitLedgerEvent(context.Background(), "order.partially_filled", "order:"+order.OrderId, order.UserId, map[string]interface{}{
		"order_id": order.OrderId, "user_id": order.UserId,
	})

	for _, et := range []string{"order.filled", "order.partially_filled"} {
		reqs := rec.requestsByType(et)
		if len(reqs) != 1 {
			t.Fatalf("%s: want 1 emit, got %d", et, len(reqs))
		}
		if reqs[0].UserId != "u_42" {
			t.Errorf("%s: AppendEventRequest.UserId = %q, want %q", et, reqs[0].UserId, "u_42")
		}
	}

	// A genuinely platform-scoped emit (no single owner) leaves UserId empty → ledger NULL.
	s.emitLedgerEvent(context.Background(), "reconciliation.mismatch_found", "account:a1", "", map[string]interface{}{
		"account_id": "a1",
	})
	pReqs := rec.requestsByType("reconciliation.mismatch_found")
	if len(pReqs) != 1 {
		t.Fatalf("reconciliation.mismatch_found: want 1 emit, got %d", len(pReqs))
	}
	if pReqs[0].UserId != "" {
		t.Errorf("platform-scoped emit UserId = %q, want empty", pReqs[0].UserId)
	}
}
