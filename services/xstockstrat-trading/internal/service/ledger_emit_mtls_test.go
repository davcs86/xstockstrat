package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
)

// failingLedgerClient fails every AppendEvent — simulating a mid-cutover mTLS handshake mismatch on
// the fire-and-forget ledger-emit edge (feature 210 design.md §Cutover safety). Embeds the interface
// so only AppendEvent is overridden.
type failingLedgerClient struct {
	ledgerv1.LedgerServiceClient
	mu    sync.Mutex
	calls int
}

func (f *failingLedgerClient) AppendEvent(_ context.Context, _ *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	return nil, grpcstatus.Error(codes.Unavailable, "simulated mTLS handshake mismatch")
}

// A failing emit dial must not wedge the caller (fail-soft) and is retried exactly appendMaxAttempts
// times — the bounded retry the flat-book cutover precondition relies on (feature 256 supersedes 210's one-shot).
func TestEmitLedgerEventFailSoftBoundedRetry(t *testing.T) {
	stub := &failingLedgerClient{}
	s := &TradingService{ledger: stub}

	done := make(chan struct{})
	go func() {
		// Must not panic and must return promptly despite AppendEvent erroring.
		s.emitLedgerEvent(context.Background(), "order.filled", "order:x", "u-1",
			map[string]interface{}{"symbol": "AAPL"})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("emitLedgerEvent wedged on a failing ledger — fail-soft violated")
	}

	stub.mu.Lock()
	calls := stub.calls
	stub.mu.Unlock()
	if calls != appendMaxAttempts {
		t.Errorf("emitLedgerEvent attempted AppendEvent %d times, want exactly %d (bounded retry)", calls, appendMaxAttempts)
	}
}
