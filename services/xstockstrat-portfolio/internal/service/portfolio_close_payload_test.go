package service

import (
	"testing"
	"time"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// feature 031 — the portfolio.position.closed payload additively carries cost_basis + opened_at when
// the closing position row was present, and omits both on the redelivered-post-close edge. The base
// producer contract keys (feature 042 + 029's fees_total) stay present and unchanged (C-16).
func TestClosedPositionPayload(t *testing.T) {
	opened := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	existing := &portfoliov1.Position{
		CostBasis: 10000,
		OpenedAt:  timestamppb.New(opened),
	}

	// With a present closing row: the two new keys carry the AC-11 ($500/$10000 → +5.0%) and
	// AC-12 (2026-02-01 → 10-day hold) inputs the UI math consumes.
	p := closedPositionPayload("u1", "AAPL", "acct-1", "TRADING_MODE_PAPER", 500, 1.20, existing)
	for k, want := range map[string]interface{}{
		"user_id":      "u1",
		"symbol":       "AAPL",
		"account_id":   "acct-1",
		"trading_mode": "TRADING_MODE_PAPER",
		"realized_pnl": 500.0,
		"fees_total":   1.20,
	} {
		if p[k] != want {
			t.Errorf("base key %q = %v, want %v", k, p[k], want)
		}
	}
	if p["cost_basis"] != float64(10000) {
		t.Errorf("cost_basis = %v, want 10000", p["cost_basis"])
	}
	if p["opened_at"] != "2026-02-01T00:00:00Z" {
		t.Errorf("opened_at = %v, want 2026-02-01T00:00:00Z", p["opened_at"])
	}

	// Redelivered-post-close edge (existing == nil, AC-13): the two new keys are absent, while the
	// base contract keys (incl. realized_pnl) are still emitted.
	edge := closedPositionPayload("u1", "AAPL", "acct-1", "TRADING_MODE_PAPER", 0, 0, nil)
	if _, ok := edge["cost_basis"]; ok {
		t.Error("cost_basis must be absent when existing == nil")
	}
	if _, ok := edge["opened_at"]; ok {
		t.Error("opened_at must be absent when existing == nil")
	}
	if _, ok := edge["realized_pnl"]; !ok {
		t.Error("realized_pnl must still be present on the redelivered edge")
	}
}
