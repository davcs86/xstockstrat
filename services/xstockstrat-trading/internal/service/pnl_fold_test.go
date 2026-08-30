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

// ── FoldFrom tests (feature 163 — snapshot-offline-positions) ──────────────────
// C-13: baseline map literals are single-consumer scenario one-offs → inline is compliant.

type foldFromVector struct {
	name     string
	baseline map[string]pnl.Lot
	fills    []pnl.Fill
	wantReal float64
	wantLots map[string]pnl.Lot
}

func TestPnLFoldFrom_Trading(t *testing.T) {
	vectors := []foldFromVector{
		{
			name:     "parity_nil_baseline_equals_Fold",
			baseline: nil,
			fills: []pnl.Fill{
				{Symbol: "AAPL", Qty: 10, Price: 190.25},
				{Symbol: "AAPL", Qty: -10, Price: 200.00},
			},
			wantReal: 97.50,
			wantLots: nil, // AAPL netted flat → absent
		},
		{
			name:     "seed_only_no_fills",
			baseline: map[string]pnl.Lot{"AAPL": {Qty: 100, CostBasis: 15000}},
			fills:    nil,
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 100, CostBasis: 15000}},
		},
		{
			// AC-2: post-T0 buy on seed → qty 150, avg ~153.33
			name:     "post_T0_buy_on_seed_AC2",
			baseline: map[string]pnl.Lot{"AAPL": {Qty: 100, CostBasis: 15000}},
			fills:    []pnl.Fill{{Symbol: "AAPL", Qty: 50, Price: 160}},
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 150, CostBasis: 23000}},
		},
		{
			// AC-4: post-T0 sell draws down seed, realizes vs baseline avg
			name:     "post_T0_sell_realizes_vs_baseline_AC4",
			baseline: map[string]pnl.Lot{"AAPL": {Qty: 100, CostBasis: 15000}},
			fills:    []pnl.Fill{{Symbol: "AAPL", Qty: -30, Price: 170}},
			wantReal: 600.00, // 30 × (170 − 150)
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 70, CostBasis: 10500}},
		},
		{
			// AC-1 LYFT short: seed a short, then verify avg
			name:     "seeded_short_round_trip",
			baseline: map[string]pnl.Lot{"LYFT": {Qty: -378, CostBasis: -4725}},
			fills:    nil,
			wantReal: 0,
			wantLots: map[string]pnl.Lot{"LYFT": {Qty: -378, CostBasis: -4725}},
		},
		{
			// Seeded short + buy-to-cover realizes correctly
			name:     "seeded_short_buy_to_cover_realizes",
			baseline: map[string]pnl.Lot{"LYFT": {Qty: -378, CostBasis: -4725}},
			fills:    []pnl.Fill{{Symbol: "LYFT", Qty: 100, Price: 10}},
			wantReal: 250.00, // 100 × (12.50 − 10.00), avg = 4725/378 = 12.50
			wantLots: map[string]pnl.Lot{"LYFT": {Qty: -278, CostBasis: -3475}},
		},
		{
			// AC-17: flatten-then-refill
			name:     "flatten_then_refill_AC17",
			baseline: map[string]pnl.Lot{"AAPL": {Qty: 100, CostBasis: 15000}},
			fills: []pnl.Fill{
				{Symbol: "AAPL", Qty: -100, Price: 165}, // flatten: realize 1500
				{Symbol: "AAPL", Qty: 30, Price: 170},   // refill at 170
			},
			wantReal: 1500.00,
			wantLots: map[string]pnl.Lot{"AAPL": {Qty: 30, CostBasis: 5100}},
		},
	}

	for _, v := range vectors {
		t.Run(v.name, func(t *testing.T) {
			got := pnl.FoldFrom(v.baseline, v.fills)
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
			// Parity case: ensure nil wantLots means empty positions
			if v.wantLots == nil && len(got.Positions) != 0 {
				t.Fatalf("expected no positions, got %+v", got.Positions)
			}
		})
	}

	// Additional parity assertion: FoldFrom(nil, fills) == Fold(fills)
	t.Run("parity_deep_equals", func(t *testing.T) {
		fills := goldenFoldVectors()[1].fills // sell_to_close_realizes_97_50
		fromNil := pnl.FoldFrom(nil, fills)
		plain := pnl.Fold(fills)
		if math.Abs(fromNil.Realized-plain.Realized) > foldEps {
			t.Fatalf("parity realized: FoldFrom=%v Fold=%v", fromNil.Realized, plain.Realized)
		}
		if len(fromNil.Positions) != len(plain.Positions) {
			t.Fatalf("parity positions len: FoldFrom=%d Fold=%d", len(fromNil.Positions), len(plain.Positions))
		}
		for sym, lot := range plain.Positions {
			fLot := fromNil.Positions[sym]
			if math.Abs(fLot.Qty-lot.Qty) > foldEps || math.Abs(fLot.CostBasis-lot.CostBasis) > foldEps {
				t.Fatalf("parity %s: FoldFrom=%+v Fold=%+v", sym, fLot, lot)
			}
		}
	})
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
