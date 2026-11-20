package handler

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/classification"
	"github.com/xstockstrat/marketdata/internal/repository"
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

// sectorHistoryStub is a classification store whose SectorHistory returns the caller's ctx error.
type sectorHistoryStub struct{}

func (sectorHistoryStub) CurrentSectors(context.Context, []string) (map[string]string, error) {
	return nil, nil
}

func (sectorHistoryStub) SectorAsOf(context.Context, string, time.Time) (string, bool, error) {
	return "", false, nil
}

func (sectorHistoryStub) SectorHistory(ctx context.Context, _ []string, _, _ *time.Time) ([]repository.ClassificationRow, error) {
	return nil, ctx.Err()
}

func (sectorHistoryStub) SeedEpoch(context.Context, string, string) (bool, error) {
	return false, nil
}

func (sectorHistoryStub) ApplyObservation(context.Context, string, string, time.Time) (classification.Action, error) {
	return 0, nil
}

func expiredCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	t.Cleanup(cancel)
	return ctx
}

// TestToGRPCError_ConnectCodeCast — feature 326 @AC-1: connect codes pass through to gRPC.
func TestToGRPCError_ConnectCodeCast(t *testing.T) {
	ctx := context.Background()
	examples := []struct {
		in   connect.Code
		want codes.Code
	}{
		{connect.CodeDeadlineExceeded, codes.DeadlineExceeded},
		{connect.CodeCanceled, codes.Canceled},
		{connect.CodeAlreadyExists, codes.AlreadyExists},
		{connect.CodeUnimplemented, codes.Unimplemented},
		{connect.CodeUnauthenticated, codes.Unauthenticated},
		{connect.CodeAborted, codes.Aborted},
	}
	for _, ex := range examples {
		got := status.Code(toGRPCError(ctx, connect.NewError(ex.in, errors.New("x"))))
		if got != ex.want {
			t.Errorf("AC-1: connect %v must map to %v, got %v", ex.in, ex.want, got)
		}
	}

	for c := connect.CodeCanceled; c <= connect.CodeUnauthenticated; c++ {
		err := toGRPCError(ctx, connect.NewError(c, errors.New("msg-"+c.String())))
		st := status.Convert(err)
		if c == connect.CodeInternal || c == connect.CodeUnknown {
			if st.Code() != codes.Internal {
				t.Errorf("connect %v must map to Internal, got %v", c, st.Code())
			}
			continue
		}
		if st.Code() != codes.Code(c) {
			t.Errorf("connect %v must map to %v, got %v", c, codes.Code(c), st.Code())
		}
		if st.Message() != "msg-"+c.String() {
			t.Errorf("connect %v message not preserved: %q", c, st.Message())
		}
	}
}

// TestToGRPCError_InboundCtx — feature 326 inbound-ctx branch, R-2 pin, @AC-53 and f254 rows.
func TestToGRPCError_InboundCtx(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	live := context.Background()

	cases := []struct {
		name    string
		ctx     context.Context
		err     error
		want    codes.Code
		wantMsg string
	}{
		{"(i) expired internal", expiredCtx(t), connect.NewError(connect.CodeInternal, context.DeadlineExceeded), codes.DeadlineExceeded, "deadline exceeded"},
		{"(ii) canceled internal", canceled, connect.NewError(connect.CodeInternal, errors.New("x")), codes.Canceled, "request canceled"},
		{"(iii) expired raw", expiredCtx(t), context.DeadlineExceeded, codes.DeadlineExceeded, ""},
		{"(iv) expired unavailable f254", expiredCtx(t), connect.NewError(connect.CodeUnavailable, context.DeadlineExceeded), codes.Unavailable, ""},
		{"(v) R-2 live internal wrapping deadline", live, connect.NewError(connect.CodeInternal, context.DeadlineExceeded), codes.Internal, ""},
	}
	for _, tc := range cases {
		st := status.Convert(toGRPCError(tc.ctx, tc.err))
		if st.Code() != tc.want {
			t.Errorf("%s: want %v, got %v", tc.name, tc.want, st.Code())
		}
		if tc.wantMsg != "" && st.Message() != tc.wantMsg {
			t.Errorf("%s: want message %q, got %q", tc.name, tc.wantMsg, st.Message())
		}
	}

	// (vi) @AC-53: a live-ctx plain error stays Internal with its text intact.
	st := status.Convert(toGRPCError(live, errors.New("live fetch failed")))
	if st.Code() != codes.Internal || !strings.Contains(st.Message(), "live fetch failed") {
		t.Errorf("(vi) @AC-53: want Internal containing %q, got %v %q", "live fetch failed", st.Code(), st.Message())
	}

	// (vii) D-8: branch (b) must not leak a wrapped vendor URL's credentials.
	urlErr := &url.Error{Op: "Get", URL: "https://vendor.example/v1?apikey=x&token=y", Err: context.DeadlineExceeded}
	msg := status.Convert(toGRPCError(expiredCtx(t), connect.NewError(connect.CodeInternal, urlErr))).Message()
	if strings.Contains(msg, "apikey=") || strings.Contains(msg, "token=") {
		t.Errorf("(vii) D-8: message leaks credentials: %q", msg)
	}
}

// TestGetSectorHistory_AC2_ExpiredCtxDeadlineExceeded — feature 326 @AC-2 handler chain.
func TestGetSectorHistory_AC2_ExpiredCtxDeadlineExceeded(t *testing.T) {
	svc := &service.MarketDataService{}
	svc.SetClassification(sectorHistoryStub{}, nil, nil)
	_, err := NewMarketDataHandler(svc).GRPCHandler().GetSectorHistory(
		expiredCtx(t),
		&marketdatav1.GetSectorHistoryRequest{Symbols: []string{"AAPL"}},
	)
	if got := status.Code(err); got != codes.DeadlineExceeded {
		t.Fatalf("AC-2: handler must return DEADLINE_EXCEEDED, not INTERNAL (got %v)", got)
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
