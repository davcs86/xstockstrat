package handler

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// TestGetLatestQuotes_EmptySymbolsRejected — feature 178, Step 4 @AC-4 handler half: the batch
// handler rejects an empty Symbols slice with CodeInvalidArgument before touching the service
// (mirrors GetFundamentalsMulti), so svc may be nil here.
func TestGetLatestQuotes_EmptySymbolsRejected(t *testing.T) {
	h := &MarketDataHandler{}
	_, err := h.GetLatestQuotes(
		context.Background(),
		connect.NewRequest(&marketdatav1.GetLatestQuotesRequest{}),
	)
	if err == nil {
		t.Fatal("expected CodeInvalidArgument for empty symbols, got nil")
	}
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("expected CodeInvalidArgument, got %v", connect.CodeOf(err))
	}
}
