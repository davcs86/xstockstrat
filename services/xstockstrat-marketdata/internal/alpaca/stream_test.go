package alpaca

// package alpaca (in-package, not alpaca_test) — required to reach dispatch and
// streamBarTimeframe, neither of which is exported (feature 080 AC-7).

import (
	"testing"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// TestDispatchBarCarries1MinEnum proves a streamed bar carries the explicit
// TIMEFRAME_1MIN label (FR-6) while the request-resolution refusal of "1m" stays
// untouched (FR-7/AC-7 — see the standing guard at internal/timeframe/timeframe_test.go:23).
//
// Constructs the subscriber map directly, bypassing add()'s connection/goroutine setup —
// no websocket, no production seam added, matching what stream.go's subs field already
// makes reachable.
func TestDispatchBarCarries1MinEnum(t *testing.T) {
	ch := make(chan *marketdatav1.Bar, 1)
	m := &streamManager{
		subs: map[int]*streamSubscriber{
			1: {symbols: map[string]bool{"AAPL": true}, barCh: ch},
		},
	}

	m.dispatch(&streamMessage{
		T: "b", S: "AAPL", Time: "2024-01-02T10:00:00Z",
		O: 1.0, H: 1.0, L: 1.0, C: 1.0, V: 1, VW: 1.0, N: 1,
	})

	select {
	case bar := <-ch:
		gotTF := bar.Timeframe //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is preserved
		if gotTF != "1m" {
			t.Errorf("expected Timeframe=%q, got %q", "1m", gotTF)
		}
		if bar.TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1MIN { //nolint:staticcheck // SA1019: deliberate assertion of the retained deprecated member — feature 080 FR-6
			t.Errorf("expected TimeframeEnum=TIMEFRAME_1MIN, got %v", bar.TimeframeEnum)
		}
	default:
		t.Fatal("dispatch did not fan out a bar to the subscriber")
	}
}
