package handler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

type fakeSub struct {
	id     string
	userID string
	ch     chan *portfoliov1.PortfolioSnapshot
}

// fakeHub mirrors the producer contract: push delivers only to subscribers registered for the owner.
type fakeHub struct {
	mu           sync.Mutex
	subs         map[string]fakeSub
	calls        []fakeSub
	unsubscribed []string
	subscribed   chan string
}

func newFakeHub() *fakeHub {
	return &fakeHub{subs: map[string]fakeSub{}, subscribed: make(chan string, 8)}
}

func (f *fakeHub) Subscribe(id, userID string) chan *portfoliov1.PortfolioSnapshot {
	ch := make(chan *portfoliov1.PortfolioSnapshot, 8)
	s := fakeSub{id: id, userID: userID, ch: ch}
	f.mu.Lock()
	f.subs[id] = s
	f.calls = append(f.calls, s)
	f.mu.Unlock()
	f.subscribed <- id
	return ch
}

func (f *fakeHub) Unsubscribe(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.subs, id)
	f.unsubscribed = append(f.unsubscribed, id)
}

func (f *fakeHub) push(owner string, snap *portfoliov1.PortfolioSnapshot) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, s := range f.subs {
		if s.userID == owner {
			s.ch <- snap
		}
	}
}

func (f *fakeHub) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeHub) recordedUsers() map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	for _, c := range f.calls {
		out[c.id] = c.userID
	}
	return out
}

func (f *fakeHub) unsubscribedSet() map[string]bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, id := range f.unsubscribed {
		out[id] = true
	}
	return out
}

func (f *fakeHub) waitSubscribed(t *testing.T, n int) {
	t.Helper()
	deadline := time.After(time.Second)
	for i := 0; i < n; i++ {
		select {
		case <-f.subscribed:
		case <-deadline:
			t.Fatalf("timed out waiting for %d subscriptions (got %d)", n, i)
		}
	}
}

type fakeGRPCStream struct {
	grpc.ServerStream
	ctx  context.Context
	sent chan *portfoliov1.PortfolioSnapshot
}

func newFakeGRPCStream(ctx context.Context) *fakeGRPCStream {
	return &fakeGRPCStream{ctx: ctx, sent: make(chan *portfoliov1.PortfolioSnapshot, 8)}
}

func (s *fakeGRPCStream) Context() context.Context { return s.ctx }

func (s *fakeGRPCStream) Send(snap *portfoliov1.PortfolioSnapshot) error {
	s.sent <- snap
	return nil
}

func expectSnapshot(t *testing.T, ch <-chan *portfoliov1.PortfolioSnapshot, wantID string) {
	t.Helper()
	select {
	case got := <-ch:
		if got.PortfolioId != wantID {
			t.Fatalf("want PortfolioId %q, got %q", wantID, got.PortfolioId)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for snapshot %q", wantID)
	}
}

func expectNoSnapshot(t *testing.T, ch <-chan *portfoliov1.PortfolioSnapshot) {
	t.Helper()
	select {
	case got := <-ch:
		t.Fatalf("stream must receive nothing, got snapshot for %q", got.PortfolioId)
	case <-time.After(100 * time.Millisecond):
	}
}

func expectCanceled(t *testing.T, errs <-chan error) {
	t.Helper()
	select {
	case err := <-errs:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("want context.Canceled, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the stream to return")
	}
}

func TestStreamPortfolioUpdates_GRPC_AC2_RejectsEmptyCaller(t *testing.T) {
	hub := newFakeHub()
	a := (&PortfolioHandler{hub: hub}).GRPCHandler()
	ctx, cancel := context.WithTimeout(ctxNoHeader(), 200*time.Millisecond)
	defer cancel()

	err := a.StreamPortfolioUpdates(&portfoliov1.StreamPortfolioUpdatesRequest{}, newFakeGRPCStream(ctx))
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("want InvalidArgument, got %v", err)
	}
	if n := hub.callCount(); n != 0 {
		t.Fatalf("anonymous stream must never subscribe; recorded %d Subscribe calls", n)
	}
}

func TestStreamPortfolioUpdates_Connect_AC6_RejectsEmptyCaller(t *testing.T) {
	hub := newFakeHub()
	h := &PortfolioHandler{hub: hub}
	//nolint:staticcheck // deliberately set the deprecated body user_id to prove it is IGNORED.
	req := &portfoliov1.StreamPortfolioUpdatesRequest{UserId: "u-1"}

	err := h.StreamPortfolioUpdates(ctxNoHeader(), connect.NewRequest(req), nil)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("body user_id must not satisfy the identity gate; want InvalidArgument, got %v", err)
	}
	if n := hub.callCount(); n != 0 {
		t.Fatalf("anonymous stream must never subscribe; recorded %d Subscribe calls", n)
	}
}

func TestStreamSnapshots_AC3_DeliversOnlyToCallersStream(t *testing.T) {
	hub := newFakeHub()
	resA := make(chan *portfoliov1.PortfolioSnapshot, 8)
	resB := make(chan *portfoliov1.PortfolioSnapshot, 8)
	ctxA, cancelA := context.WithCancel(context.Background())
	ctxB, cancelB := context.WithCancel(context.Background())
	defer cancelA()
	defer cancelB()
	errA := make(chan error, 1)
	errB := make(chan error, 1)

	go func() {
		errA <- streamSnapshots(ctxA, hub, "u-1", "a", 0, func(s *portfoliov1.PortfolioSnapshot) error { resA <- s; return nil })
	}()
	go func() {
		errB <- streamSnapshots(ctxB, hub, "u-2", "b", 0, func(s *portfoliov1.PortfolioSnapshot) error { resB <- s; return nil })
	}()
	hub.waitSubscribed(t, 2)

	users := hub.recordedUsers()
	if len(users) != 2 || users["a"] != "u-1" || users["b"] != "u-2" {
		t.Fatalf("want subscriptions {a: u-1, b: u-2}, got %v", users)
	}

	hub.push("u-1", &portfoliov1.PortfolioSnapshot{PortfolioId: "u-1"})
	expectSnapshot(t, resA, "u-1")
	expectNoSnapshot(t, resB)

	cancelA()
	cancelB()
	expectCanceled(t, errA)
	expectCanceled(t, errB)
	unsub := hub.unsubscribedSet()
	if !unsub["a"] || !unsub["b"] {
		t.Fatalf("both subscriptions must be released; unsubscribed %v", unsub)
	}
}

func TestStreamPortfolioUpdates_GRPC_AC1_WiresCallerIdentity(t *testing.T) {
	hub := newFakeHub()
	a := (&PortfolioHandler{hub: hub}).GRPCHandler()
	ctxA, cancelA := context.WithCancel(ctxWithHeader("u-1"))
	ctxB, cancelB := context.WithCancel(ctxWithHeader("u-2"))
	defer cancelA()
	defer cancelB()
	sA := newFakeGRPCStream(ctxA)
	sB := newFakeGRPCStream(ctxB)
	errA := make(chan error, 1)
	errB := make(chan error, 1)

	go func() { errA <- a.StreamPortfolioUpdates(&portfoliov1.StreamPortfolioUpdatesRequest{}, sA) }()
	go func() { errB <- a.StreamPortfolioUpdates(&portfoliov1.StreamPortfolioUpdatesRequest{}, sB) }()
	hub.waitSubscribed(t, 2)

	users := hub.recordedUsers()
	seen := map[string]int{}
	for _, u := range users {
		seen[u]++
	}
	if len(users) != 2 || seen["u-1"] != 1 || seen["u-2"] != 1 {
		t.Fatalf("want subscriptions for exactly {u-1, u-2}, got %v", users)
	}

	hub.push("u-1", &portfoliov1.PortfolioSnapshot{PortfolioId: "u-1"})
	expectSnapshot(t, sA.sent, "u-1")
	expectNoSnapshot(t, sB.sent)

	cancelA()
	cancelB()
	expectCanceled(t, errA)
	expectCanceled(t, errB)
	unsub := hub.unsubscribedSet()
	for id := range users {
		if !unsub[id] {
			t.Fatalf("subscription %q must be released; unsubscribed %v", id, unsub)
		}
	}
}

func TestStreamSnapshots_TradingModeFilterPreserved(t *testing.T) {
	hub := newFakeHub()
	res := make(chan *portfoliov1.PortfolioSnapshot, 8)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errs := make(chan error, 1)

	go func() {
		errs <- streamSnapshots(ctx, hub, "u-1", "a", commonv1.TradingMode_TRADING_MODE_PAPER, func(s *portfoliov1.PortfolioSnapshot) error { res <- s; return nil })
	}()
	hub.waitSubscribed(t, 1)

	hub.push("u-1", &portfoliov1.PortfolioSnapshot{PortfolioId: "live", TradingMode: commonv1.TradingMode_TRADING_MODE_LIVE})
	hub.push("u-1", &portfoliov1.PortfolioSnapshot{PortfolioId: "paper", TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER})
	expectSnapshot(t, res, "paper")
	expectNoSnapshot(t, res)

	cancel()
	expectCanceled(t, errs)
}
