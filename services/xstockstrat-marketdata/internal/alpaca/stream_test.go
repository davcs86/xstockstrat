package alpaca

// package alpaca (in-package, not alpaca_test) — required to reach dispatch, which is not
// exported (feature 080 AC-7).

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

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
		// Feature 196: the deprecated string is omitted at this response edge; the enum carries the label.
		if gotTF := bar.Timeframe; gotTF != "" { //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is omitted (feature 196)
			t.Errorf("expected deprecated Timeframe string omitted, got %q", gotTF)
		}
		if bar.TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1MIN { //nolint:staticcheck // SA1019: deliberate assertion of the retained deprecated member — feature 080 FR-6
			t.Errorf("expected TimeframeEnum=TIMEFRAME_1MIN, got %v", bar.TimeframeEnum)
		}
	default:
		t.Fatal("dispatch did not fan out a bar to the subscriber")
	}
}

// newStreamTestServer serves one websocket per dial and hands each connection to behave.
func newStreamTestServer(t *testing.T, behave func(conn *websocket.Conn)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		behave(conn)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// newStreamTestManager builds a manager dialing srv; its ctx is cancelled in t.Cleanup.
func newStreamTestManager(t *testing.T, srv *httptest.Server, cfg ClientConfig) (*streamManager, context.CancelFunc) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	t.Cleanup(stop)
	return &streamManager{
		cfg:       cfg,
		ctx:       ctx,
		stop:      stop,
		streamURL: "ws" + strings.TrimPrefix(srv.URL, "http"),
		subs:      make(map[int]*streamSubscriber),
	}, stop
}

// lockedBuffer is a goroutine-safe sink for the stream loop's slog output.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// AC-7: a subscription-acked session resets the budget, so 4 healthy drops with
// MaxReconnects 3 still reconnect a 5th time and the subscriber stays open.
func TestStreamManager_BudgetResetsAfterHealthySession_AC7(t *testing.T) {
	var conns atomic.Int32
	srv := newStreamTestServer(t, func(conn *websocket.Conn) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if conns.Add(1) > 4 {
			for { // hold the 5th session open until the client goes away
				if _, _, err := conn.Read(ctx); err != nil {
					return
				}
			}
		}
		for i := 0; i < 2; i++ { // auth, subscribe
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
		_ = conn.Write(ctx, websocket.MessageText, []byte(`[{"T":"subscription"}]`))
		_ = conn.Close(websocket.StatusNormalClosure, "")
	})
	m, _ := newStreamTestManager(t, srv, ClientConfig{MaxReconnects: 3, ReconnectDelayMs: 1})

	subCtx, cancelSub := context.WithCancel(context.Background())
	t.Cleanup(cancelSub)
	barCh := m.subscribe(subCtx, []string{"AAPL"}, true)

	waitFor(t, 5*time.Second, func() bool { return conns.Load() >= 5 },
		"a 5th connection (budget must reset after a healthy session)")

	select {
	case _, ok := <-barCh:
		if !ok {
			t.Fatal("subscriber channel closed; healthy sessions must not exhaust the budget")
		}
	default:
	}
	if got := m.subscriberCount(); got != 1 {
		t.Fatalf("subscriberCount = %d, want 1", got)
	}
}

// AC-8: three consecutive unhealthy sessions exhaust MaxReconnects 3, every subscriber
// channel is closed and the ERROR log names the budget.
func TestStreamManager_GiveUpClosesSubscribers_AC8(t *testing.T) {
	logs := &lockedBuffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelError})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	srv := newStreamTestServer(t, func(conn *websocket.Conn) {
		_ = conn.Close(websocket.StatusNormalClosure, "")
	})
	m, _ := newStreamTestManager(t, srv, ClientConfig{MaxReconnects: 3, ReconnectDelayMs: 1})

	subCtx, cancelSub := context.WithCancel(context.Background())
	t.Cleanup(cancelSub)
	barCh := m.subscribe(subCtx, []string{"AAPL"}, true)

	select {
	case _, ok := <-barCh:
		if ok {
			t.Fatal("received a bar; want the channel closed on give-up")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("subscriber channel not closed after give-up")
	}

	out := logs.String()
	if !strings.Contains(out, "giving up") || !strings.Contains(out, "max=3") {
		t.Fatalf("give-up ERROR log missing the exhausted budget; got %q", out)
	}

	// The subscriber's removal goroutine runs after the give-up close; it must not close again.
	cancelSub()
	time.Sleep(50 * time.Millisecond)
	if got := m.subscriberCount(); got != 0 {
		t.Fatalf("subscriberCount = %d, want 0", got)
	}
}

// Cancelling the manager ctx during a long backoff returns run promptly with running=false.
func TestStreamManager_BackoffCancellable(t *testing.T) {
	var conns atomic.Int32
	srv := newStreamTestServer(t, func(conn *websocket.Conn) {
		conns.Add(1)
		_ = conn.Close(websocket.StatusNormalClosure, "")
	})
	m, stop := newStreamTestManager(t, srv, ClientConfig{MaxReconnects: 3, ReconnectDelayMs: 600_000})

	subCtx, cancelSub := context.WithCancel(context.Background())
	t.Cleanup(cancelSub)
	_ = m.subscribe(subCtx, []string{"AAPL"}, true)

	waitFor(t, 5*time.Second, func() bool { return conns.Load() >= 1 }, "the first connection")
	time.Sleep(50 * time.Millisecond) // let run enter the 600s backoff
	stop()

	waitFor(t, 2*time.Second, func() bool {
		m.mu.Lock()
		defer m.mu.Unlock()
		return !m.running
	}, "run to return after the manager ctx was cancelled during backoff")
	if got := conns.Load(); got != 1 {
		t.Fatalf("connections = %d, want 1 (no reconnect after cancel)", got)
	}
}
