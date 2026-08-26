package service

import (
	"math"
	"testing"

	"github.com/xstockstrat/contracts/pnl"
)

// This file is the portfolio-side half of the cross-service golden-vector parity proof for the
// shared pnl.Fold (feature 157, the feature-056 dual-source fix). The IDENTICAL vector table runs
// in xstockstrat-trading/internal/service/pnl_fold_test.go — both must agree, since no CI job runs
// `go test` inside packages/proto/. It also serves as the characterization test pinning the realized
// outputs GetPnL produced before the applyFill closure was extracted onto pnl.Fold.
//
// C-13: the fill/lot literals have a single consumer per module → inline is compliant.

const foldEps = 1e-9

type foldVector struct {
	name      string
	fills     []pnl.Fill
	wantReal  float64
	wantLots  map[string]pnl.Lot // symbols expected present; flat symbols must be absent
	wantFlats []string           // symbols expected to have netted flat (absent from Positions)
}

// goldenFoldVectors is the shared parity table. Keep byte-identical with the trading-side copy.
func goldenFoldVectors() []foldVector {
	return []foldVector{
		{
			// @AC-10 idempotent re-edit: a ConfirmOrder edit replaces the order's fill, so the
			// recompute folds the corrected fill (10@191.00), yielding qty 10 at avg 191.00 — never
			// 20 shares (the recompute-from-all-confirmed-orders is not incremental).
			name:     "idempotent_reedit_corrected_fill",
			fills:    []pnl.Fill{{Symbol: "AAPL", Qty: 10, Price: 191.00}},
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 10, CostBasis: 1910.00}},
		},
		{
			// @AC-11 sell-to-close: BUY 10@190.25 then SELL 10@200.00 nets flat with realized +97.50.
			name: "sell_to_close_realizes_97_50",
			fills: []pnl.Fill{
				{Symbol: "AAPL", Qty: 10, Price: 190.25},
				{Symbol: "AAPL", Qty: -10, Price: 200.00},
			},
			wantReal:  97.50,
			wantFlats: []string{"AAPL"},
		},
		{
			// @AC-12 sell-to-open short: a lone SELL opens a net-negative lot (shorts in scope).
			name:     "sell_to_open_short",
			fills:    []pnl.Fill{{Symbol: "TSLA", Qty: -5, Price: 250.00}},
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"TSLA": {Qty: -5, CostBasis: -1250.00}},
		},
		{
			// partial reduce: BUY 10@100 then SELL 4@110 → 6 left, realized 40.
			name: "partial_reduce",
			fills: []pnl.Fill{
				{Symbol: "MSFT", Qty: 10, Price: 100.00},
				{Symbol: "MSFT", Qty: -4, Price: 110.00},
			},
			wantReal: 40.00,
			wantLots: map[string]pnl.Lot{"MSFT": {Qty: 6, CostBasis: 600.00}},
		},
		{
			// re-average through a full flip: close then reopen the reversed side, realized survives.
			name: "close_then_reopen_long",
			fills: []pnl.Fill{
				{Symbol: "NVDA", Qty: 10, Price: 190.25},
				{Symbol: "NVDA", Qty: -10, Price: 200.00},
				{Symbol: "NVDA", Qty: 5, Price: 180.00},
			},
			wantReal: 97.50,
			wantLots: map[string]pnl.Lot{"NVDA": {Qty: 5, CostBasis: 900.00}},
		},
	}
}

func TestPnLFoldGoldenVectors_Portfolio(t *testing.T) {
	assertFoldVectors(t, goldenFoldVectors())
}

// assertFoldVectors is duplicated verbatim in the trading-side copy (parity, not shared code — the
// two modules cannot import each other's tests).
func assertFoldVectors(t *testing.T, vectors []foldVector) {
	t.Helper()
	for _, v := range vectors {
		t.Run(v.name, func(t *testing.T) {
			got := pnl.Fold(v.fills)
			if math.Abs(got.Realized-v.wantReal) > foldEps {
				t.Fatalf("realized: got %v want %v", got.Realized, v.wantReal)
			}
			for sym, wantLot := range v.wantLots {
				gotLot, ok := got.Positions[sym]
				if !ok {
					t.Fatalf("symbol %s: expected lot %+v, absent from Positions", sym, wantLot)
				}
				if math.Abs(gotLot.Qty-wantLot.Qty) > foldEps || math.Abs(gotLot.CostBasis-wantLot.CostBasis) > foldEps {
					t.Fatalf("symbol %s: got %+v want %+v", sym, gotLot, wantLot)
				}
			}
			for _, sym := range v.wantFlats {
				if _, ok := got.Positions[sym]; ok {
					t.Fatalf("symbol %s: expected flat (absent), but present: %+v", sym, got.Positions[sym])
				}
			}
		})
	}
}

// TestRealizedDelta_Portfolio pins the single-fill reduce used by ConsumeOrderFills.
func TestRealizedDelta_Portfolio(t *testing.T) {
	// long reduced by a sell realizes (fillPrice - avgEntry) * closedQty.
	if got := pnl.RealizedDelta(10, 1902.50, -10, 200.00); math.Abs(got-97.50) > foldEps {
		t.Fatalf("realized delta close: got %v want 97.50", got)
	}
	// same-direction (adding) realizes nothing.
	if got := pnl.RealizedDelta(10, 1902.50, 5, 210.00); got != 0 {
		t.Fatalf("realized delta add: got %v want 0", got)
	}
	// empty position realizes nothing.
	if got := pnl.RealizedDelta(0, 0, -10, 200.00); got != 0 {
		t.Fatalf("realized delta from flat: got %v want 0", got)
	}
}
