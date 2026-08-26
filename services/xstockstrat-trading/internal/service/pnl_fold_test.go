package service

import (
	"math"
	"testing"

	"github.com/xstockstrat/contracts/pnl"
)

// This file is the trading-side half of the cross-service golden-vector parity proof for the shared
// pnl.Fold (feature 157). The IDENTICAL vector table runs in
// xstockstrat-portfolio/internal/service/pnl_fold_test.go — both modules must agree, since no CI job
// runs `go test` inside packages/proto/. trading's ConfirmOrder recompute builds []pnl.Fill from the
// account's confirmed orders and folds them the same way.
//
// C-13: the fill/lot literals have a single consumer per module → inline is compliant.

const foldEps = 1e-9

type foldVector struct {
	name      string
	fills     []pnl.Fill
	wantReal  float64
	wantLots  map[string]pnl.Lot
	wantFlats []string
}

// goldenFoldVectors is the shared parity table. Keep byte-identical with the portfolio-side copy.
func goldenFoldVectors() []foldVector {
	return []foldVector{
		{
			name:     "idempotent_reedit_corrected_fill",
			fills:    []pnl.Fill{{Symbol: "AAPL", Qty: 10, Price: 191.00}},
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 10, CostBasis: 1910.00}},
		},
		{
			name: "sell_to_close_realizes_97_50",
			fills: []pnl.Fill{
				{Symbol: "AAPL", Qty: 10, Price: 190.25},
				{Symbol: "AAPL", Qty: -10, Price: 200.00},
			},
			wantReal:  97.50,
			wantFlats: []string{"AAPL"},
		},
		{
			name:     "sell_to_open_short",
			fills:    []pnl.Fill{{Symbol: "TSLA", Qty: -5, Price: 250.00}},
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"TSLA": {Qty: -5, CostBasis: -1250.00}},
		},
		{
			name: "partial_reduce",
			fills: []pnl.Fill{
				{Symbol: "MSFT", Qty: 10, Price: 100.00},
				{Symbol: "MSFT", Qty: -4, Price: 110.00},
			},
			wantReal: 40.00,
			wantLots: map[string]pnl.Lot{"MSFT": {Qty: 6, CostBasis: 600.00}},
		},
		{
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

func TestPnLFoldGoldenVectors_Trading(t *testing.T) {
	assertFoldVectors(t, goldenFoldVectors())
}

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

func TestRealizedDelta_Trading(t *testing.T) {
	if got := pnl.RealizedDelta(10, 1902.50, -10, 200.00); math.Abs(got-97.50) > foldEps {
		t.Fatalf("realized delta close: got %v want 97.50", got)
	}
	if got := pnl.RealizedDelta(10, 1902.50, 5, 210.00); got != 0 {
		t.Fatalf("realized delta add: got %v want 0", got)
	}
	if got := pnl.RealizedDelta(0, 0, -10, 200.00); got != 0 {
		t.Fatalf("realized delta from flat: got %v want 0", got)
	}
}
