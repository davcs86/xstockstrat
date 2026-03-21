package service

import (
	"testing"
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
