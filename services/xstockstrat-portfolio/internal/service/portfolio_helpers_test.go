package service

import (
	"encoding/json"
	"math"
	"testing"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// TestPositionMath replicates the core position calculation logic from
// processOrderFill to verify correctness without requiring real gRPC connections.
// The logic under test is in portfolio_service.go (processOrderFill).

type positionState struct {
	Qty           float64
	AvgEntryPrice float64
	CostBasis     float64
}

// computeNewPosition mirrors the logic in processOrderFill.
func computeNewPosition(existing *positionState, fillQty, fillPrice float64) (newQty, newAvgEntry, newCost float64) {
	if existing != nil {
		newQty = existing.Qty + fillQty
		if fillQty > 0 { // buying more
			newCost = existing.CostBasis + fillQty*fillPrice
			newAvgEntry = newCost / newQty
		} else { // selling
			newCost = existing.CostBasis * (newQty / existing.Qty)
			newAvgEntry = existing.AvgEntryPrice
		}
	} else {
		newQty = fillQty
		newCost = fillQty * fillPrice
		newAvgEntry = fillPrice
	}
	return
}

func TestPositionMath_NewPosition(t *testing.T) {
	newQty, newAvg, newCost := computeNewPosition(nil, 100.0, 50.0)
	if newQty != 100.0 {
		t.Errorf("NewPosition qty: got %v, want 100", newQty)
	}
	if newAvg != 50.0 {
		t.Errorf("NewPosition avgEntry: got %v, want 50", newAvg)
	}
	if newCost != 5000.0 {
		t.Errorf("NewPosition cost: got %v, want 5000", newCost)
	}
}

func TestPositionMath_BuyMore(t *testing.T) {
	existing := &positionState{Qty: 100, AvgEntryPrice: 50.0, CostBasis: 5000.0}
	newQty, newAvg, newCost := computeNewPosition(existing, 50.0, 60.0) // buy 50 more at 60

	if newQty != 150.0 {
		t.Errorf("BuyMore qty: got %v, want 150", newQty)
	}
	// Expected avg = (5000 + 50*60) / 150 = 8000 / 150 = 53.333...
	expectedAvg := 8000.0 / 150.0
	if newAvg < expectedAvg-0.001 || newAvg > expectedAvg+0.001 {
		t.Errorf("BuyMore avgEntry: got %v, want %v", newAvg, expectedAvg)
	}
	if newCost != 8000.0 {
		t.Errorf("BuyMore cost: got %v, want 8000", newCost)
	}
}

func TestPositionMath_PartialSell(t *testing.T) {
	existing := &positionState{Qty: 100, AvgEntryPrice: 50.0, CostBasis: 5000.0}
	newQty, newAvg, newCost := computeNewPosition(existing, -30.0, 65.0) // sell 30

	if newQty != 70.0 {
		t.Errorf("PartialSell qty: got %v, want 70", newQty)
	}
	// avgEntry stays the same on sell
	if newAvg != 50.0 {
		t.Errorf("PartialSell avgEntry: got %v, want 50 (unchanged)", newAvg)
	}
	// cost basis scales proportionally: 5000 * (70/100) = 3500
	if newCost != 3500.0 {
		t.Errorf("PartialSell cost: got %v, want 3500", newCost)
	}
}

func TestPositionMath_FullClose(t *testing.T) {
	existing := &positionState{Qty: 100, AvgEntryPrice: 50.0, CostBasis: 5000.0}
	newQty, _, _ := computeNewPosition(existing, -100.0, 70.0) // sell all

	if newQty != 0.0 {
		t.Errorf("FullClose qty: got %v, want 0", newQty)
	}
}

func TestPositionMath_OverSell(t *testing.T) {
	existing := &positionState{Qty: 50, AvgEntryPrice: 100.0, CostBasis: 5000.0}
	newQty, _, _ := computeNewPosition(existing, -60.0, 110.0) // sell more than held

	// newQty goes negative — caller should detect this and close position
	if newQty != -10.0 {
		t.Errorf("OverSell qty: got %v, want -10", newQty)
	}
}

// computeRealizedPnL mirrors the two-pass GetPnL algorithm for dependency-free unit testing.
// completeFills use fill.Qty (order.filled events); partialFills use fill.FilledQty
// (order.partially_filled events, deduplicated by OrderID keeping the last per ID).
func computeRealizedPnL(completeFills, partialFills []orderFillPayload) float64 {
	var realized float64
	accs := make(map[string]*fillAccumulator)
	filledOrderIDs := make(map[string]bool)

	applyFill := func(qty, fillPrice float64, symbol string) {
		acc := accs[symbol]
		if acc == nil {
			acc = &fillAccumulator{}
			accs[symbol] = acc
		}
		sameDirection := acc.qty == 0 || (qty > 0) == (acc.qty > 0)
		if sameDirection {
			acc.qty += qty
			acc.costBasis += qty * fillPrice
		} else {
			avgEntry := acc.costBasis / acc.qty
			closeQty := qty
			if math.Abs(closeQty) > math.Abs(acc.qty) {
				closeQty = -acc.qty
			}
			realized += (-closeQty) * (fillPrice - avgEntry)
			oldQty := acc.qty
			acc.qty += closeQty
			if math.Abs(acc.qty) < 1e-9 {
				acc.qty = 0
				acc.costBasis = 0
			} else {
				acc.costBasis = acc.costBasis * acc.qty / oldQty
			}
			remainder := qty - closeQty
			if math.Abs(remainder) > 1e-9 {
				acc.qty += remainder
				acc.costBasis += remainder * fillPrice
			}
		}
	}

	// Pass 1: apply complete fills.
	for _, fill := range completeFills {
		filledOrderIDs[fill.OrderID] = true
		applyFill(fill.Qty, fill.FillPrice, fill.Symbol)
	}

	// Pass 2: deduplicate partial fills by OrderID (last wins), apply for non-completed orders.
	latestPartials := make(map[string]orderFillPayload)
	for _, fill := range partialFills {
		latestPartials[fill.OrderID] = fill
	}
	for orderID, fill := range latestPartials {
		if filledOrderIDs[orderID] {
			continue
		}
		applyFill(fill.FilledQty, fill.FillPrice, fill.Symbol)
	}

	return realized
}

func TestRealizedPnL_NoFills(t *testing.T) {
	got := computeRealizedPnL(nil, nil)
	if got != 0.0 {
		t.Errorf("NoFills: got %f, want 0.0", got)
	}
}

func TestRealizedPnL_ClosedLong(t *testing.T) {
	fills := []orderFillPayload{
		{OrderID: "A", Symbol: "AAPL", Qty: 100, FillPrice: 50},
		{OrderID: "B", Symbol: "AAPL", Qty: -100, FillPrice: 70},
	}
	got := computeRealizedPnL(fills, nil)
	if got != 2000.0 {
		t.Errorf("ClosedLong: got %f, want 2000.0", got)
	}
}

func TestRealizedPnL_ClosedShort(t *testing.T) {
	fills := []orderFillPayload{
		{OrderID: "A", Symbol: "TSLA", Qty: -100, FillPrice: 50}, // open short
		{OrderID: "B", Symbol: "TSLA", Qty: 100, FillPrice: 40},  // close short
	}
	got := computeRealizedPnL(fills, nil)
	if got != 1000.0 {
		t.Errorf("ClosedShort: got %f, want 1000.0", got)
	}
}

func TestRealizedPnL_MultipleOrders(t *testing.T) {
	fills := []orderFillPayload{
		{OrderID: "A", Symbol: "MSFT", Qty: 50, FillPrice: 50},
		{OrderID: "B", Symbol: "MSFT", Qty: 50, FillPrice: 50},
		{OrderID: "C", Symbol: "MSFT", Qty: -50, FillPrice: 70},
		{OrderID: "D", Symbol: "MSFT", Qty: -50, FillPrice: 70},
	}
	got := computeRealizedPnL(fills, nil)
	if got != 2000.0 {
		t.Errorf("MultipleOrders: got %f, want 2000.0", got)
	}
}

func TestRealizedPnL_MixedOpenAndClosed(t *testing.T) {
	fills := []orderFillPayload{
		{OrderID: "A", Symbol: "GOOG", Qty: 100, FillPrice: 50},
		{OrderID: "B", Symbol: "GOOG", Qty: 50, FillPrice: 60},
		{OrderID: "C", Symbol: "GOOG", Qty: -80, FillPrice: 75},
	}
	got := computeRealizedPnL(fills, nil)
	// avg_cost after A+B = (5000+3000)/150 = 53.333...; sell 80@75 → 80*(75-53.333...) = 1733.333...
	want := 80.0 * (75.0 - 8000.0/150.0)
	if math.Abs(got-want) > 0.01 {
		t.Errorf("MixedOpenAndClosed: got %f, want %f (±0.01)", got, want)
	}
}

func TestRealizedPnL_PartiallyFilledCanceled(t *testing.T) {
	completeFills := []orderFillPayload{
		{OrderID: "B", Symbol: "NVDA", Qty: -50, FillPrice: 70}, // complete sell
	}
	partialFills := []orderFillPayload{
		{OrderID: "A", Symbol: "NVDA", FilledQty: 50, FillPrice: 50}, // partial buy, never completed
	}
	got := computeRealizedPnL(completeFills, partialFills)
	// Pass 1: sell -50@70 → short; Pass 2: buy 50@50 closes short → realized = (-50)*(50-70) = 1000
	if got != 1000.0 {
		t.Errorf("PartiallyFilledCanceled: got %f, want 1000.0", got)
	}
}

// resolveSyncUserID mirrors the user_id resolution in processPositionSync: use the
// payload's user_id when present, falling back to "default" for legacy events.
func resolveSyncUserID(sync positionSyncPayload) string {
	userID := sync.UserID
	if userID == "" {
		userID = "default"
	}
	return userID
}

func TestPositionSyncPayload_ParsesUserID(t *testing.T) {
	raw := `{
		"account_id": "acct-123",
		"user_id": "user-abc",
		"trading_mode": "TRADING_MODE_LIVE",
		"positions": [{"symbol": "AAPL", "qty": 10, "avg_cost": 150.5}]
	}`
	var sync positionSyncPayload
	if err := json.Unmarshal([]byte(raw), &sync); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sync.UserID != "user-abc" {
		t.Errorf("UserID: got %q, want %q", sync.UserID, "user-abc")
	}
	if got := resolveSyncUserID(sync); got != "user-abc" {
		t.Errorf("resolveSyncUserID: got %q, want %q", got, "user-abc")
	}
	if len(sync.Positions) != 1 || sync.Positions[0].Symbol != "AAPL" {
		t.Errorf("Positions: got %+v", sync.Positions)
	}
}

func TestPositionSyncPayload_FallsBackToDefault(t *testing.T) {
	// Legacy event without user_id (pre-propagation) must fall back to "default".
	raw := `{"account_id": "acct-123", "trading_mode": "TRADING_MODE_PAPER", "positions": []}`
	var sync positionSyncPayload
	if err := json.Unmarshal([]byte(raw), &sync); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := resolveSyncUserID(sync); got != "default" {
		t.Errorf("resolveSyncUserID (legacy): got %q, want %q", got, "default")
	}
}

// dayPnL mirrors the day-P&L derivation in ListPortfolios: equity vs. previous
// close, guarding the percentage against a zero LastEquity divisor.
func dayPnL(bal balanceSyncPayload) (pnl, pct float64) {
	pnl = bal.Equity - bal.LastEquity
	if bal.LastEquity > 0 {
		pct = pnl / bal.LastEquity
	}
	return pnl, pct
}

func TestBalanceSyncPayload_ParsesAndDerivesDayPnL(t *testing.T) {
	raw := `{
		"account_id": "acct-123",
		"user_id": "user-abc",
		"trading_mode": "TRADING_MODE_PAPER",
		"cash": 1000.50,
		"buying_power": 4000,
		"equity": 2500,
		"last_equity": 2400
	}`
	var bal balanceSyncPayload
	if err := json.Unmarshal([]byte(raw), &bal); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if bal.Cash != 1000.50 || bal.BuyingPower != 4000 || bal.Equity != 2500 {
		t.Errorf("balance fields parsed wrong: %+v", bal)
	}
	pnl, pct := dayPnL(bal)
	if pnl != 100 {
		t.Errorf("dayPnL: got %v, want 100", pnl)
	}
	if math.Abs(pct-100.0/2400.0) > 1e-9 {
		t.Errorf("dayPnLPct: got %v, want %v", pct, 100.0/2400.0)
	}
}

func TestBalanceSyncPayload_ZeroLastEquityGuardsPct(t *testing.T) {
	// last_equity == 0 must not divide-by-zero; pct stays 0.
	bal := balanceSyncPayload{Equity: 500, LastEquity: 0}
	pnl, pct := dayPnL(bal)
	if pnl != 500 {
		t.Errorf("dayPnL: got %v, want 500", pnl)
	}
	if pct != 0 {
		t.Errorf("dayPnLPct guard: got %v, want 0", pct)
	}
}

// TestSideOf verifies qty-sign → PositionSide derivation (Step 4 / feature 056).
func TestSideOf(t *testing.T) {
	cases := []struct {
		name string
		qty  float64
		want portfoliov1.PositionSide
	}{
		{"long", 10, portfoliov1.PositionSide_POSITION_SIDE_LONG},
		{"short", -10, portfoliov1.PositionSide_POSITION_SIDE_SHORT},
		{"flat", 0, portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sideOf(tc.qty); got != tc.want {
				t.Errorf("sideOf(%v) = %v, want %v", tc.qty, got, tc.want)
			}
		})
	}
}

// TestEnrichPosition verifies the price-enrichment math for a winner, a loser, and the
// zero-cost-basis divide-by-zero guard (the P&L-sign data the UI winners/losers filter relies on).
func TestEnrichPosition(t *testing.T) {
	cases := []struct {
		name                                   string
		qty, costBasis, ask, bid               float64
		wantPrice, wantMV, wantPnL, wantPnLPct float64
	}{
		{"winner", 10, 1000, 120, 120, 120, 1200, 200, 0.2},
		{"loser", 10, 1000, 80, 80, 80, 800, -200, -0.2},
		{"zero_cost_basis", 10, 0, 50, 50, 50, 500, 500, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &portfoliov1.Position{Qty: tc.qty, CostBasis: tc.costBasis}
			enrichPosition(p, tc.ask, tc.bid)
			nearlyEqualPos(t, "current_price", p.CurrentPrice, tc.wantPrice)
			nearlyEqualPos(t, "market_value", p.MarketValue, tc.wantMV)
			nearlyEqualPos(t, "unrealized_pnl", p.UnrealizedPnl, tc.wantPnL)
			nearlyEqualPos(t, "unrealized_pnl_pct", p.UnrealizedPnlPct, tc.wantPnLPct)
		})
	}
}

func nearlyEqualPos(t *testing.T, field string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("%s: got %v, want %v", field, got, want)
	}
}
