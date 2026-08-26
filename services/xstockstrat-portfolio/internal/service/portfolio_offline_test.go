package service

import (
	"encoding/json"
	"testing"
)

// TestPositionSyncPayload_RealizedPnlDisjointness proves the offline/broker disjointness signal
// (feature 157, @AC-14): an offline ConfirmOrder emit carries a realized_pnl key → the pointer is
// non-nil, so processPositionSync upserts the realized row; a broker position sync omits the key →
// the pointer is nil, so the realized table is never touched. This mirrors processPositionSync's
// gate (`if sync.RealizedPnl != nil`) at the parse boundary — the service's repo is a concrete
// *PortfolioRepo with no live-DB test harness, so the gate's input is what's asserted here.
func TestPositionSyncPayload_RealizedPnlDisjointness(t *testing.T) {
	// Offline recompute emit: realized_pnl present (a genuine $0 is still present, not omitted).
	offline := `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER",
		"positions":[{"symbol":"AAPL","qty":10,"avg_cost":190.25}],"realized_pnl":97.5}`
	var off positionSyncPayload
	if err := json.Unmarshal([]byte(offline), &off); err != nil {
		t.Fatalf("unmarshal offline payload: %v", err)
	}
	if off.RealizedPnl == nil {
		t.Fatal("offline emit must carry a non-nil RealizedPnl pointer (upsert would be skipped)")
	}
	if *off.RealizedPnl != 97.5 {
		t.Errorf("RealizedPnl = %v, want 97.5", *off.RealizedPnl)
	}

	// Offline full-close emit: positions:[] with realized_pnl still present → realized survives.
	flat := `{"account_id":"off-1","user_id":"u1","trading_mode":"TRADING_MODE_PAPER","positions":[],"realized_pnl":97.5}`
	var f positionSyncPayload
	if err := json.Unmarshal([]byte(flat), &f); err != nil {
		t.Fatalf("unmarshal flat payload: %v", err)
	}
	if f.RealizedPnl == nil || *f.RealizedPnl != 97.5 {
		t.Error("a full-close offline emit must still carry realized_pnl (survives the position wipe)")
	}

	// Broker position sync: no realized_pnl key → nil pointer → realized table untouched.
	broker := `{"account_id":"brk-1","user_id":"u1","trading_mode":"TRADING_MODE_LIVE",
		"positions":[{"symbol":"AAPL","qty":10,"avg_cost":190.25,"current_price":200,"market_value":2000}]}`
	var brk positionSyncPayload
	if err := json.Unmarshal([]byte(broker), &brk); err != nil {
		t.Fatalf("unmarshal broker payload: %v", err)
	}
	if brk.RealizedPnl != nil {
		t.Error("a broker position sync must leave RealizedPnl nil (disjoint from the offline path)")
	}
}

// TestAccountDeregisteredPayload_Parse proves the deregister purge consumer reads account_id/user_id
// (feature 157, @AC-15).
func TestAccountDeregisteredPayload_Parse(t *testing.T) {
	var p accountDeregisteredPayload
	if err := json.Unmarshal([]byte(`{"account_id":"off-1","user_id":"u1"}`), &p); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if p.AccountID != "off-1" || p.UserID != "u1" {
		t.Errorf("parsed %+v, want account_id off-1 / user_id u1", p)
	}
}
