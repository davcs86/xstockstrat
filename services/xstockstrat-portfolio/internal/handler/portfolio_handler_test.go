package handler

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/service"
)

func TestClassifyGetPositionError_NotFound(t *testing.T) {
	got := classifyGetPositionError(repository.ErrPositionNotFound)
	if got != connect.CodeNotFound {
		t.Fatalf("got %v, want CodeNotFound", got)
	}
}

func TestClassifyGetPositionError_WrappedNotFound(t *testing.T) {
	wrapped := fmt.Errorf("get position: %w", repository.ErrPositionNotFound)
	got := classifyGetPositionError(wrapped)
	if got != connect.CodeNotFound {
		t.Fatalf("got %v, want CodeNotFound for a wrapped sentinel", got)
	}
}

func TestClassifyGetPositionError_GenericError_IsInternal(t *testing.T) {
	got := classifyGetPositionError(errors.New("db connection reset"))
	if got != connect.CodeInternal {
		t.Fatalf("got %v, want CodeInternal for a non-sentinel error", got)
	}
}

// feature 229 @AC-5: a quote gap maps to Unavailable at both the Connect and the gRPC edge; everything else stays Internal.
func TestClassifyGetPnLError(t *testing.T) {
	if got := classifyGetPnLError(context.Background(), fmt.Errorf("GetPnL: no usable quote for MSFT: %w", service.ErrQuotesUnavailable)); got != connect.CodeUnavailable {
		t.Fatalf("wrapped ErrQuotesUnavailable: got %v, want CodeUnavailable", got)
	}
	// feature 257 @AC-4: a failed or looping ledger page is Unavailable too.
	ledgerErr := fmt.Errorf("GetPnL: QueryEvents (order.filled): %w: %w", service.ErrLedgerUnavailable, status.Error(codes.DeadlineExceeded, "d"))
	if got := classifyGetPnLError(context.Background(), ledgerErr); got != connect.CodeUnavailable {
		t.Fatalf("wrapped ErrLedgerUnavailable: got %v, want CodeUnavailable", got)
	}
	if code := status.Code(toGRPCError(connect.NewError(classifyGetPnLError(context.Background(), ledgerErr), ledgerErr))); code != codes.Unavailable {
		t.Fatalf("toGRPCError(ledger unavailable) = %v, want codes.Unavailable", code)
	}
	if got := classifyGetPnLError(context.Background(), errors.New("db connection reset")); got != connect.CodeInternal {
		t.Fatalf("generic error: got %v, want CodeInternal", got)
	}
	if code := status.Code(toGRPCError(connect.NewError(connect.CodeUnavailable, errors.New("q")))); code != codes.Unavailable {
		t.Fatalf("toGRPCError(Unavailable) = %v, want codes.Unavailable", code)
	}
}

// feature 251 @AC-4/@AC-7: the caller's own ctx wins over the wrapped sentinel; an unresolvable fill is FailedPrecondition.
func TestClassifyGetPnLError_CtxFirst(t *testing.T) {
	expired, cancelExp := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancelExp()
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	quote := fmt.Errorf("GetPnL: %w", service.ErrQuotesUnavailable)
	cases := []struct {
		name string
		ctx  context.Context
		err  error
		want connect.Code
	}{
		{"expired ctx", expired, quote, connect.CodeDeadlineExceeded},
		{"cancelled ctx", cancelled, quote, connect.CodeCanceled},
		{"unattributable fill", context.Background(), fmt.Errorf("GetPnL: %w", service.ErrFillUnattributable), connect.CodeFailedPrecondition},
	}
	for _, c := range cases {
		if got := classifyGetPnLError(c.ctx, c.err); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestToGRPCError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want codes.Code
	}{
		{"invalid argument", connect.NewError(connect.CodeInvalidArgument, errors.New("x")), codes.InvalidArgument},
		{"not found", connect.NewError(connect.CodeNotFound, errors.New("x")), codes.NotFound},
		{"permission denied", connect.NewError(connect.CodePermissionDenied, errors.New("x")), codes.PermissionDenied},
		{"unavailable", connect.NewError(connect.CodeUnavailable, errors.New("x")), codes.Unavailable},
		{"failed precondition", connect.NewError(connect.CodeFailedPrecondition, errors.New("x")), codes.FailedPrecondition},
		{"deadline exceeded", connect.NewError(connect.CodeDeadlineExceeded, errors.New("x")), codes.DeadlineExceeded},
		{"canceled", connect.NewError(connect.CodeCanceled, errors.New("x")), codes.Canceled},
		{"non-connect error", errors.New("boom"), codes.Internal},
	}
	for _, c := range cases {
		if got := status.Code(toGRPCError(c.err)); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
