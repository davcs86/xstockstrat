// Package pnl is the single realized-P&L fold shared by xstockstrat-trading and
// xstockstrat-portfolio. Dependency-free (float math only — no proto/DB imports).
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

// Fold applies fills in caller-supplied economic order (e.g. filled_at ASC) and returns net
// positions plus cumulative realized P&L. Short lots are retained (no oversell guard); a lot with
// |qty| < 1e-9 is treated as flat and dropped from Positions.
func Fold(fills []Fill) FoldResult {
	return foldInto(make(map[string]Lot), fills)
}

// FoldFrom seeds the accumulator from baseline lots, then applies fills. FoldFrom(nil, fills)
// is exactly Fold(fills). Seed CostBasis is signed total (qty × avg_cost_per_share).
func FoldFrom(baseline map[string]Lot, fills []Fill) FoldResult {
	accs := make(map[string]Lot, len(baseline))
	for sym, lot := range baseline {
		accs[sym] = lot
	}
	return foldInto(accs, fills)
}

// foldInto mutates accs in place (the caller owns the map) and returns the fold result.
func foldInto(accs map[string]Lot, fills []Fill) FoldResult {
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
