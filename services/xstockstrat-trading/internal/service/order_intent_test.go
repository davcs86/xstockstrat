package service

import (
	"testing"
	"time"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

func TestComputeRequestHash_Deterministic(t *testing.T) {
	req1 := &tradingv1.PlaceOrderRequest{Symbol: "AAPL", Qty: 10}
	req2 := &tradingv1.PlaceOrderRequest{Symbol: "AAPL", Qty: 10}
	req3 := &tradingv1.PlaceOrderRequest{Symbol: "AAPL", Qty: 20}

	h1, err := computeRequestHash(req1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	h2, err := computeRequestHash(req2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	h3, err := computeRequestHash(req3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(h1) != string(h2) {
		t.Error("identical messages must hash identically")
	}
	if string(h1) == string(h3) {
		t.Error("messages differing in one field must hash differently")
	}
}

func TestPlaceOrderRequestHash_IgnoresClientOrderId(t *testing.T) {
	req1 := &tradingv1.PlaceOrderRequest{Symbol: "AAPL", Qty: 10, ClientOrderId: "nonce-a"}
	req2 := &tradingv1.PlaceOrderRequest{Symbol: "AAPL", Qty: 10, ClientOrderId: "nonce-b"}
	req3 := &tradingv1.PlaceOrderRequest{Symbol: "TSLA", Qty: 10, ClientOrderId: "nonce-a"}

	h1, err := placeOrderRequestHash(req1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	h2, err := placeOrderRequestHash(req2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	h3, err := placeOrderRequestHash(req3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(h1) != string(h2) {
		t.Error("two requests differing only in ClientOrderId must hash identically")
	}
	if string(h1) == string(h3) {
		t.Error("changing a non-nonce field must change the hash")
	}
}

func TestDeriveReplaceCancelIntentID_Deterministic(t *testing.T) {
	req1 := &tradingv1.ReplaceOrderRequest{OrderId: "o1", Qty: 50}
	req2 := &tradingv1.ReplaceOrderRequest{OrderId: "o1", Qty: 50}
	req3 := &tradingv1.ReplaceOrderRequest{OrderId: "o1", Qty: 75}

	id1, hash1, err := deriveReplaceCancelIntentID(req1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	id2, hash2, err := deriveReplaceCancelIntentID(req2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	id3, _, err := deriveReplaceCancelIntentID(req3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id1 != id2 || hash1 != hash2 {
		t.Error("identical request content must derive the same intent ID and hash")
	}
	if id1 == id3 {
		t.Error("different request content must derive a different intent ID (overwhelmingly)")
	}
}

func TestClassifyIntentLookup(t *testing.T) {
	now := time.Now()
	staleThresh := 15 * time.Second

	cases := []struct {
		name       string
		existing   *repository.OrderIntentRecord
		reqHash    string
		wantAction intentAction
		wantStale  bool
	}{
		{
			name:       "hash mismatch",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStatePending, UpdatedAt: now},
			reqHash:    "bbb",
			wantAction: intentActionRejectHashMismatch,
		},
		{
			name:       "completed returns stored",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStateCompleted, UpdatedAt: now},
			reqHash:    "aaa",
			wantAction: intentActionReturnStored,
		},
		{
			name:       "rejected returns stored",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStateRejected, UpdatedAt: now},
			reqHash:    "aaa",
			wantAction: intentActionReturnStored,
		},
		{
			name:       "unknown rejects",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStateUnknown, UpdatedAt: now},
			reqHash:    "aaa",
			wantAction: intentActionRejectUnknown,
		},
		{
			name:       "pending not yet stale",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStatePending, UpdatedAt: now},
			reqHash:    "aaa",
			wantAction: intentActionRejectPending,
			wantStale:  false,
		},
		{
			name:       "pending stale",
			existing:   &repository.OrderIntentRecord{RequestHash: "aaa", State: repository.IntentStatePending, UpdatedAt: now.Add(-1 * time.Hour)},
			reqHash:    "aaa",
			wantAction: intentActionRejectPending,
			wantStale:  true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			action, isStale := classifyIntentLookup(c.existing, c.reqHash, now, staleThresh)
			if action != c.wantAction {
				t.Errorf("action = %v, want %v", action, c.wantAction)
			}
			if action == intentActionRejectPending && isStale != c.wantStale {
				t.Errorf("isStale = %v, want %v", isStale, c.wantStale)
			}
		})
	}
}

func TestComputeStaleThreshold_ClampsMultiplierFloor(t *testing.T) {
	// config.Watcher has no exported snapshot setter (confirmed, no way to inject a custom
	// stale_multiplier through staleThreshold(cfgW) directly — mirrors feature 100's
	// currentTradingState test limitation), so the clamp math is factored into this pure,
	// directly-testable function (mirrors feature 100's parseTradingState pattern).
	got := computeStaleThreshold(5000, 1.0) // multiplier below the 1.5 floor
	want := time.Duration(5000*1.5) * time.Millisecond
	if got != want {
		t.Errorf("computeStaleThreshold(5000, 1.0) = %v, want %v (clamped to the 1.5x floor)", got, want)
	}
}

func TestComputeStaleThreshold_AboveFloorUnclamped(t *testing.T) {
	got := computeStaleThreshold(5000, 3.0)
	want := time.Duration(5000*3.0) * time.Millisecond
	if got != want {
		t.Errorf("computeStaleThreshold(5000, 3.0) = %v, want %v (no clamp needed)", got, want)
	}
}

func TestStaleThreshold_UsesLiveConfigDefaults(t *testing.T) {
	cfgW := &config.Watcher{} // zero-Watcher -> every GetFloat/GetInt default
	got := staleThreshold(cfgW)
	floorMs := int64(5000) // trading.broker.timeout_ms default
	if int64(broker.IBKRRequestTimeout/time.Millisecond) > floorMs {
		floorMs = int64(broker.IBKRRequestTimeout / time.Millisecond)
	}
	want := computeStaleThreshold(floorMs, 3.0) // trading.order_intent.stale_multiplier default
	if got != want {
		t.Errorf("staleThreshold(zero-Watcher) = %v, want %v (the documented defaults)", got, want)
	}
}
