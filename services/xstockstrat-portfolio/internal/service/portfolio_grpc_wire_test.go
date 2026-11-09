package service_test

// Drives the real gRPC adapter over a real service so the wire status code, not just the classifier, is asserted.

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/handler"
	"github.com/xstockstrat/portfolio/internal/service"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

const wirePaper = "TRADING_MODE_PAPER"

func wireAdapter(t *testing.T, l ledgerv1.LedgerServiceClient, positions ...service.WirePosition) portfoliov1.PortfolioServiceServer {
	t.Helper()
	return handler.NewPortfolioHandler(service.NewWireTestService(t, l, positions...)).GRPCHandler()
}

func wireGetPnL(t *testing.T, a portfoliov1.PortfolioServiceServer, ctx context.Context) error {
	t.Helper()
	var err error
	service.Guard(t, func() { _, err = a.GetPnL(ctx, &portfoliov1.GetPnLRequest{}) })
	return err
}

func wantCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	if got := status.Code(err); got != want {
		t.Fatalf("status code = %v (err=%v), want %v", got, err, want)
	}
}

func TestWire251_AC4_UnresolvedSideFailedPrecondition(t *testing.T) {
	l := &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{
		testdata.FilledEvent(1, "o-x", "u-1", "AAPL", "a1", wirePaper, 10, 100, ""),
	}}
	wantCode(t, wireGetPnL(t, wireAdapter(t, l), service.CtxWithUser(t, "u-1")), codes.FailedPrecondition)
}

func TestWire251_AC6_LedgerErrorUnavailable(t *testing.T) {
	l := &testdata.Ledger{}
	l.OnQuery = func(context.Context, *ledgerv1.QueryEventsRequest) error { return errors.New("ledger down") }
	wantCode(t, wireGetPnL(t, wireAdapter(t, l), service.CtxWithUser(t, "u-1")), codes.Unavailable)
}

func TestWire251_AC7_CallerCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(service.CtxWithUser(t, "u-1"))
	defer cancel()
	l := &testdata.Ledger{}
	l.OnQuery = func(c context.Context, _ *ledgerv1.QueryEventsRequest) error {
		cancel()
		return c.Err()
	}
	wantCode(t, wireGetPnL(t, wireAdapter(t, l), ctx), codes.Canceled)
}

func TestWire251_AC7_CallerDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(service.CtxWithUser(t, "u-1"), 200*time.Millisecond)
	defer cancel()
	l := &testdata.Ledger{}
	l.OnQuery = func(c context.Context, _ *ledgerv1.QueryEventsRequest) error {
		<-c.Done()
		return c.Err()
	}
	wantCode(t, wireGetPnL(t, wireAdapter(t, l), ctx), codes.DeadlineExceeded)
}

func TestWire_DeleteSystemManagedWatchlist_F127AC7(t *testing.T) {
	a := wireAdapter(t, &testdata.Ledger{})
	ctx := service.CtxWithUser(t, "u-1")
	ensured, err := a.EnsureSignalWatchlist(ctx, &portfoliov1.EnsureSignalWatchlistRequest{})
	if err != nil {
		t.Fatalf("EnsureSignalWatchlist: %v", err)
	}
	_, err = a.DeleteWatchlist(ctx, &portfoliov1.DeleteWatchlistRequest{WatchlistId: ensured.GetWatchlist().GetWatchlistId()})
	wantCode(t, err, codes.FailedPrecondition)
}

func TestWire251_MissingUserIDInvalidArgument(t *testing.T) {
	wantCode(t, wireGetPnL(t, wireAdapter(t, &testdata.Ledger{}), context.Background()), codes.InvalidArgument)
}

func TestWire_GetPnLQuoteGap_F229AC5(t *testing.T) {
	a := wireAdapter(t, &testdata.Ledger{}, service.WirePosition{Symbol: "AAPL", AccountID: "a1", Qty: 10, Avg: 100, Current: 0})
	wantCode(t, wireGetPnL(t, a, service.CtxWithUser(t, "u-1")), codes.Unavailable)
}
