package handler

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/grpc/metadata"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// The self-scoped read RPCs resolve the caller from the trusted x-user-id header, not the
// deprecated request-body user_id. These tests pin that the header is the gate: a request with no
// header is rejected InvalidArgument even when the (ignored) body user_id is populated — the
// validation runs before the service, so a nil service is never reached.

func ctxNoHeader() context.Context { return context.Background() }

func ctxWithHeader(userID string) context.Context {
	return metadata.NewIncomingContext(
		context.Background(),
		metadata.New(map[string]string{"x-user-id": userID}),
	)
}

func TestListPositions_RejectsWithoutHeader_IgnoringBodyUserID(t *testing.T) {
	h := &PortfolioHandler{}
	//nolint:staticcheck // deliberately set the deprecated body user_id to prove it is IGNORED.
	req := connect.NewRequest(&portfoliov1.ListPositionsRequest{UserId: "u1"})
	_, err := h.ListPositions(ctxNoHeader(), req)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("body user_id must not satisfy the identity gate; want InvalidArgument, got %v", err)
	}
}

func TestGetPortfolio_RejectsWithoutHeader(t *testing.T) {
	h := &PortfolioHandler{}
	_, err := h.GetPortfolio(ctxNoHeader(), connect.NewRequest(&portfoliov1.GetPortfolioRequest{}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v", err)
	}
}

func TestGetPnL_RejectsWithoutHeader(t *testing.T) {
	h := &PortfolioHandler{}
	_, err := h.GetPnL(ctxNoHeader(), connect.NewRequest(&portfoliov1.GetPnLRequest{}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v", err)
	}
}

func TestGetPosition_RejectsWithoutHeader(t *testing.T) {
	h := &PortfolioHandler{}
	_, err := h.GetPosition(ctxNoHeader(), connect.NewRequest(&portfoliov1.GetPositionRequest{Symbol: "AAPL"}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v", err)
	}
}

// The server-streaming RPC bypasses the unary interceptor, so it resolves x-user-id straight off
// the incoming metadata. Prove that resolution (the positive path a real stream request carries).
func TestStreamUserID_ResolvesFromIncomingMetadata(t *testing.T) {
	if got := streamUserID(ctxWithHeader("user-42")); got != "user-42" {
		t.Fatalf("streamUserID = %q, want user-42", got)
	}
	if got := streamUserID(ctxNoHeader()); got != "" {
		t.Fatalf("streamUserID with no header = %q, want empty", got)
	}
}
