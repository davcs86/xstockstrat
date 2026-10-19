package handler

import (
	"errors"
	"fmt"
	"testing"

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
	if got := classifyGetPnLError(fmt.Errorf("GetPnL: no usable quote for MSFT: %w", service.ErrQuotesUnavailable)); got != connect.CodeUnavailable {
		t.Fatalf("wrapped ErrQuotesUnavailable: got %v, want CodeUnavailable", got)
	}
	if got := classifyGetPnLError(errors.New("db connection reset")); got != connect.CodeInternal {
		t.Fatalf("generic error: got %v, want CodeInternal", got)
	}
	if code := status.Code(toGRPCError(connect.NewError(connect.CodeUnavailable, errors.New("q")))); code != codes.Unavailable {
		t.Fatalf("toGRPCError(Unavailable) = %v, want codes.Unavailable", code)
	}
}
