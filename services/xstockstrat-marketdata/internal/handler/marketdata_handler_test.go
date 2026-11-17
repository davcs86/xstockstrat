package handler

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/service"
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

// The adapter forwards the gRPC context and maps the service's PermissionDenied to the gRPC code.
func TestSyncWatchlistDelistings_AdapterMapsPermissionDenied(t *testing.T) {
	adapter := NewMarketDataHandler(&service.MarketDataService{}).GRPCHandler()
	_, err := adapter.SyncWatchlistDelistings(context.Background(), &marketdatav1.SyncWatchlistDelistingsRequest{Symbols: []string{"AAPL"}})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("SyncWatchlistDelistings without a grant = %v, want PermissionDenied", err)
	}
}

func TestAckDelistingAlerts_AdapterMapsPermissionDenied(t *testing.T) {
	adapter := NewMarketDataHandler(&service.MarketDataService{}).GRPCHandler()
	_, err := adapter.AckDelistingAlerts(context.Background(), &marketdatav1.AckDelistingAlertsRequest{Symbols: []string{"AAPL"}})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("AckDelistingAlerts without a grant = %v, want PermissionDenied", err)
	}
}
