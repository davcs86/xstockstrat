package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"google.golang.org/grpc"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// stubMarketData satisfies marketdatav1.MarketDataServiceClient by embedding the interface (nil):
// only the two quote methods are overridden with counters. Any other method would panic if called —
// these tests never call one. Feature 178, Step 6.
type stubMarketData struct {
	marketdatav1.MarketDataServiceClient
	getLatestQuotesCalls int
	getLatestQuoteCalls  int
	quotes               []*marketdatav1.Quote
	quotesErr            error
}

func (s *stubMarketData) GetLatestQuotes(_ context.Context, _ *marketdatav1.GetLatestQuotesRequest, _ ...grpc.CallOption) (*marketdatav1.GetLatestQuotesResponse, error) {
	s.getLatestQuotesCalls++
	if s.quotesErr != nil {
		return nil, s.quotesErr
	}
	return &marketdatav1.GetLatestQuotesResponse{Quotes: s.quotes}, nil
}

func (s *stubMarketData) GetLatestQuote(_ context.Context, _ *marketdatav1.GetLatestQuoteRequest, _ ...grpc.CallOption) (*marketdatav1.Quote, error) {
	s.getLatestQuoteCalls++
	return &marketdatav1.Quote{}, nil
}

// TestEnrichPositions_OneBatchedCall — @AC-1: enriching N un-broker-valued positions issues exactly
// one batched GetLatestQuotes call and zero per-position GetLatestQuote calls, and each position's
// CurrentPrice is the byte-identical (Ask+Bid)/2 mid (PR#735 formula-parity guard, fails.md:38).
func TestEnrichPositions_OneBatchedCall(t *testing.T) {
	const n = 30
	positions := make([]*portfoliov1.Position, 0, n)
	quotes := make([]*marketdatav1.Quote, 0, n)
	for i := 0; i < n; i++ {
		sym := fmt.Sprintf("SYM%02d", i)
		positions = append(positions, &portfoliov1.Position{Symbol: sym, Qty: 10, CurrentPrice: 0})
		quotes = append(quotes, &marketdatav1.Quote{Symbol: sym, AskPrice: float64(100 + i), BidPrice: float64(98 + i)})
	}
	stub := &stubMarketData{quotes: quotes}
	svc := &PortfolioService{marketdata: stub}

	svc.enrichPositions(context.Background(), positions)

	if stub.getLatestQuotesCalls != 1 {
		t.Fatalf("want exactly 1 batched GetLatestQuotes call, got %d", stub.getLatestQuotesCalls)
	}
	if stub.getLatestQuoteCalls != 0 {
		t.Fatalf("per-position fan-out must be gone, got %d singular calls", stub.getLatestQuoteCalls)
	}
	for i, p := range positions {
		want := (float64(100+i) + float64(98+i)) / 2 // reference serial mid
		if p.CurrentPrice != want {
			t.Fatalf("position %s CurrentPrice=%v, want mid %v", p.Symbol, p.CurrentPrice, want)
		}
	}
}

// TestEnrichPositions_MissingQuoteLeftUnenriched — @AC-4: a symbol the batch omits stays at its
// pre-enrich neutral value (no fabricated zero price/market value) — identical to the old
// per-position error-skip outcome (null-not-zero).
func TestEnrichPositions_MissingQuoteLeftUnenriched(t *testing.T) {
	positions := []*portfoliov1.Position{
		{Symbol: "AAPL", Qty: 5, CurrentPrice: 0},
		{Symbol: "NOQUOTE", Qty: 5, CurrentPrice: 0},
	}
	stub := &stubMarketData{quotes: []*marketdatav1.Quote{
		{Symbol: "AAPL", AskPrice: 190, BidPrice: 189}, // NOQUOTE deliberately omitted
	}}
	svc := &PortfolioService{marketdata: stub}

	svc.enrichPositions(context.Background(), positions)

	if positions[0].CurrentPrice != (190.0+189.0)/2 {
		t.Fatalf("AAPL should be enriched to the mid, got %v", positions[0].CurrentPrice)
	}
	if positions[1].CurrentPrice != 0 || positions[1].MarketValue != 0 {
		t.Fatalf("NOQUOTE must stay neutral (0), got price=%v marketValue=%v",
			positions[1].CurrentPrice, positions[1].MarketValue)
	}
}

// TestEnrichPositions_WholeCallErrorLeavesAllUnenriched — a batch RPC error is the whole-call
// equivalent of N failing singular calls: every position is treated as missing (skipped), never
// zero-filled.
func TestEnrichPositions_WholeCallErrorLeavesAllUnenriched(t *testing.T) {
	positions := []*portfoliov1.Position{
		{Symbol: "AAPL", Qty: 5, CurrentPrice: 0},
		{Symbol: "TSLA", Qty: 5, CurrentPrice: 0},
	}
	stub := &stubMarketData{quotesErr: errors.New("marketdata down")}
	svc := &PortfolioService{marketdata: stub}

	svc.enrichPositions(context.Background(), positions)

	if stub.getLatestQuotesCalls != 1 {
		t.Fatalf("want exactly 1 batched call, got %d", stub.getLatestQuotesCalls)
	}
	for _, p := range positions {
		if p.CurrentPrice != 0 || p.MarketValue != 0 {
			t.Fatalf("%s should stay unenriched on a whole-call error, got price=%v", p.Symbol, p.CurrentPrice)
		}
	}
}
