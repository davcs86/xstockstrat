package service

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
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

func TestAppendLedgerEvent_CallerKeyReachesLedgerUnchanged(t *testing.T) {
	rec := &recordingLedger{}
	s := &TradingService{ledger: rec}
	const key = "bracket-leg:acc-1:leg-tp-1:FILLED:10"

	if err := s.appendLedgerEvent(context.Background(), "order.filled", "order:leg-tp-1", "u_42", key, map[string]interface{}{}); err != nil {
		t.Fatalf("appendLedgerEvent: %v", err)
	}
	reqs := rec.requestsByType("order.filled")
	if len(reqs) != 1 {
		t.Fatalf("want 1 emit, got %d", len(reqs))
	}
	if reqs[0].IdempotencyKey != key {
		t.Errorf("IdempotencyKey = %q, want %q", reqs[0].IdempotencyKey, key)
	}
}

func TestAppendLedgerEvent_CallerKeyReusedOnUnavailableRetry(t *testing.T) {
	rec := &recordingLedger{}
	s := &TradingService{ledger: rec}
	const key = "bracket-leg:acc-1:leg-tp-1:PARTIALLY_FILLED:4"
	calls := 0
	rec.setFailFn(func(*ledgerv1.AppendEventRequest) error {
		calls++
		if calls == 1 {
			return grpcstatus.Error(codes.Unavailable, "transient")
		}
		return nil
	})

	if err := s.appendLedgerEvent(context.Background(), "order.partially_filled", "order:leg-tp-1", "u_42", key, map[string]interface{}{}); err != nil {
		t.Fatalf("appendLedgerEvent: %v", err)
	}
	reqs := rec.requestsByType("order.partially_filled")
	if len(reqs) != 2 {
		t.Fatalf("recorded %d requests, want 2 (one Unavailable retry)", len(reqs))
	}
	for i, r := range reqs {
		if r.IdempotencyKey != key {
			t.Errorf("attempt %d IdempotencyKey = %q, want %q", i+1, r.IdempotencyKey, key)
		}
	}
}

func TestAppendLedgerEvent_EmptyKeyGeneratesOne(t *testing.T) {
	rec := &recordingLedger{}
	s := &TradingService{ledger: rec}

	for i := 0; i < 2; i++ {
		if err := s.appendLedgerEvent(context.Background(), "order.filled", "order:o1", "u_42", "", map[string]interface{}{}); err != nil {
			t.Fatalf("appendLedgerEvent: %v", err)
		}
	}
	reqs := rec.requestsByType("order.filled")
	if len(reqs) != 2 {
		t.Fatalf("want 2 emits, got %d", len(reqs))
	}
	if reqs[0].IdempotencyKey == "" || reqs[1].IdempotencyKey == "" {
		t.Fatalf("empty key not generated: %q, %q", reqs[0].IdempotencyKey, reqs[1].IdempotencyKey)
	}
	if reqs[0].IdempotencyKey == reqs[1].IdempotencyKey {
		t.Errorf("two empty-key appends shared key %q, want distinct generated keys", reqs[0].IdempotencyKey)
	}
}
