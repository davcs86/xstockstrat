// Package pnl is the single realized-P&L fold shared by xstockstrat-trading and
// xstockstrat-portfolio (feature 157). It is deliberately dependency-free (float math only —
// no proto/DB imports) so both Go services can route their signed average-cost realized-P&L
// computation through one implementation, eliminating the dual-source drift that feature 056
// caused when two copies of the reduce formula disagreed.
//
// This is a small hand-written, NON-generated helper hosted inside the contracts module. Its
// tests live in the consuming service test modules because no CI job runs `go test` inside
// packages/proto/ (proto-freshness only diffs gen/).
package pnl

import "math"

// RealizedDelta returns the realized P&L contributed by fillQty@fillPrice reducing a position of
// accQty at average cost accCost/accQty. A non-reducing (opening/adding, or empty) fill returns 0.
// Signs: accQty/fillQty are signed (positive = long, negative = short); accCost is qty × avg_entry.
func RealizedDelta(accQty, accCost, fillQty, fillPrice float64) float64 {
	sameDirection := accQty == 0 || (fillQty > 0) == (accQty > 0)
	if sameDirection {
		return 0
	}
	avgEntry := accCost / accQty
	closeQty := fillQty
	if math.Abs(closeQty) > math.Abs(accQty) {
		closeQty = -accQty
	}
	return (-closeQty) * (fillPrice - avgEntry)
}

// Fill is one signed fill applied by Fold. Qty is signed: positive = buy, negative = sell.
type Fill struct {
	Symbol string
	Qty    float64 // signed: positive = buy, negative = sell
	Price  float64 // per-share fill price
}

// Lot is the net position for one symbol after a fold.
type Lot struct {
	Qty       float64 // signed: positive = long, negative = short
	CostBasis float64 // signed: qty × avg_entry_price
}

// FoldResult is the outcome of folding a fill sequence.
type FoldResult struct {
	Positions map[string]Lot // per-symbol net lot; symbols that netted flat are omitted
	Realized  float64        // cumulative realized P&L across all reducing fills
}

// Fold applies fills in the order given and returns the resulting net positions plus cumulative
// realized P&L. The caller is responsible for economic ordering (e.g. filled_at ASC). It uses the
// signed average-cost method: same-direction fills accumulate; opposite-direction fills realize via
// RealizedDelta, flip through zero with the remainder re-opening the reversed side. Net-negative
// (short) lots are retained (no oversell guard — shorts are in scope). A lot whose |qty| drops below
// 1e-9 is treated as flat and dropped from Positions.
func Fold(fills []Fill) FoldResult {
	accs := make(map[string]Lot)
	var realized float64

	for _, f := range fills {
		acc := accs[f.Symbol]
		sameDirection := acc.Qty == 0 || (f.Qty > 0) == (acc.Qty > 0)
		if sameDirection {
			acc.Qty += f.Qty
			acc.CostBasis += f.Qty * f.Price
		} else {
			realized += RealizedDelta(acc.Qty, acc.CostBasis, f.Qty, f.Price)
			closeQty := f.Qty
			if math.Abs(closeQty) > math.Abs(acc.Qty) {
				closeQty = -acc.Qty
			}
			oldQty := acc.Qty
			acc.Qty += closeQty
			if math.Abs(acc.Qty) < 1e-9 {
				acc.Qty = 0
				acc.CostBasis = 0
			} else {
				acc.CostBasis = acc.CostBasis * acc.Qty / oldQty
			}
			remainder := f.Qty - closeQty
			if math.Abs(remainder) > 1e-9 {
				acc.Qty += remainder
				acc.CostBasis += remainder * f.Price
			}
		}
		if math.Abs(acc.Qty) < 1e-9 {
			delete(accs, f.Symbol)
		} else {
			accs[f.Symbol] = acc
		}
	}

	return FoldResult{Positions: accs, Realized: realized}
}
