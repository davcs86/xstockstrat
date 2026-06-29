package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/middleware"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// New logic is in an excluded package (`service/`) — no coverage threshold applies
// to it; these unit tests plus the Step 9 E2E provide behavioral verification.

// ─── Test doubles ────────────────────────────────────────────────────────────

// fakeWatchlistStore is an in-memory WatchlistStore.
type fakeWatchlistStore struct {
	byID map[string]*portfoliov1.Watchlist
	seq  int
}

func newFakeStore() *fakeWatchlistStore {
	return &fakeWatchlistStore{byID: map[string]*portfoliov1.Watchlist{}}
}

func clone(wl *portfoliov1.Watchlist) *portfoliov1.Watchlist {
	return proto.Clone(wl).(*portfoliov1.Watchlist)
}

func (f *fakeWatchlistStore) Create(_ context.Context, userID, name, description string, symbols []string) (*portfoliov1.Watchlist, error) {
	f.seq++
	id := fmt.Sprintf("wl-%d", f.seq)
	wl := &portfoliov1.Watchlist{WatchlistId: id, UserId: userID, Name: name, Description: description, Symbols: append([]string{}, symbols...)}
	f.byID[id] = wl
	return clone(wl), nil
}

func (f *fakeWatchlistStore) GetByID(_ context.Context, watchlistID string) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	return clone(wl), nil
}

func (f *fakeWatchlistStore) ListByUser(_ context.Context, userID string, _ int, _ string) ([]*portfoliov1.Watchlist, string, error) {
	var out []*portfoliov1.Watchlist
	for _, wl := range f.byID {
		if wl.UserId == userID {
			out = append(out, clone(wl))
		}
	}
	return out, "", nil
}

func (f *fakeWatchlistStore) Update(_ context.Context, watchlistID, name, description string, symbols []string) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	wl.Name, wl.Description, wl.Symbols = name, description, append([]string{}, symbols...)
	return clone(wl), nil
}

func (f *fakeWatchlistStore) Delete(_ context.Context, watchlistID string) error {
	if _, ok := f.byID[watchlistID]; !ok {
		return repository.ErrWatchlistNotFound
	}
	delete(f.byID, watchlistID)
	return nil
}

func (f *fakeWatchlistStore) AddSymbols(_ context.Context, watchlistID string, symbols []string) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	seen := map[string]struct{}{}
	for _, s := range wl.Symbols {
		seen[s] = struct{}{}
	}
	for _, s := range symbols {
		if _, dup := seen[s]; !dup {
			wl.Symbols = append(wl.Symbols, s)
			seen[s] = struct{}{}
		}
	}
	return clone(wl), nil
}

func (f *fakeWatchlistStore) RemoveSymbols(_ context.Context, watchlistID string, symbols []string) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	drop := map[string]struct{}{}
	for _, s := range symbols {
		drop[s] = struct{}{}
	}
	kept := wl.Symbols[:0]
	for _, s := range wl.Symbols {
		if _, d := drop[s]; !d {
			kept = append(kept, s)
		}
	}
	wl.Symbols = kept
	return clone(wl), nil
}

func (f *fakeWatchlistStore) CountByUser(_ context.Context, userID string) (int, error) {
	n := 0
	for _, wl := range f.byID {
		if wl.UserId == userID {
			n++
		}
	}
	return n, nil
}

// fakeConfig returns caps that the test can mutate between calls.
type fakeConfig struct{ vals map[string]int64 }

func (c *fakeConfig) GetInt(key string, def int64) int64 {
	if v, ok := c.vals[key]; ok {
		return v
	}
	return def
}

// fakeLedger captures AppendEvent calls; err lets a test force ledger failure.
type fakeLedger struct {
	ledgerv1.LedgerServiceClient
	calls int
	err   error
}

func (f *fakeLedger) AppendEvent(_ context.Context, _ *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &ledgerv1.AppendEventResponse{}, nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func newSvc(store WatchlistStore, cfg watchlistConfig, ledger ledgerv1.LedgerServiceClient) *PortfolioService {
	return &PortfolioService{watchlists: store, wlCfg: cfg, ledger: ledger}
}

// ctxWithUser injects an x-user-id into context via the real server interceptor.
func ctxWithUser(t *testing.T, userID string) context.Context {
	t.Helper()
	var captured context.Context
	in := metadata.NewIncomingContext(context.Background(), metadata.New(map[string]string{"x-user-id": userID}))
	_, err := middleware.UnaryServerInterceptor(in, nil, &grpc.UnaryServerInfo{},
		func(c context.Context, _ any) (any, error) { captured = c; return nil, nil })
	if err != nil {
		t.Fatalf("interceptor: %v", err)
	}
	return captured
}

func wideCaps() *fakeConfig {
	return &fakeConfig{vals: map[string]int64{
		"portfolio.watchlist.max_per_user":         1000,
		"portfolio.watchlist.max_symbols_per_list": 1000,
	}}
}

// ─── normalizeSymbols ────────────────────────────────────────────────────────

func TestNormalizeSymbols(t *testing.T) {
	got := normalizeSymbols([]string{"aapl", "AAPL", " msft ", "", "MSFT"})
	want := []string{"AAPL", "MSFT"}
	if len(got) != len(want) {
		t.Fatalf("normalizeSymbols: got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeSymbols[%d]: got %q want %q (%v)", i, got[i], want[i], got)
		}
	}
}

// ─── AC-1: round-trip + uppercase/dedupe ─────────────────────────────────────

func TestCreateGetRoundTrip_NormalizesSymbols(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "userA")

	created, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{
		Name: "Tech", Symbols: []string{"aapl", "AAPL", "msft"},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if got := created.Watchlist.Symbols; len(got) != 2 || got[0] != "AAPL" || got[1] != "MSFT" {
		t.Fatalf("symbols not normalized: %v", got)
	}
	got, err := svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: created.Watchlist.WatchlistId})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Watchlist.Name != "Tech" || len(got.Watchlist.Symbols) != 2 {
		t.Fatalf("round-trip mismatch: %+v", got.Watchlist)
	}
}

// ─── AC-2: ownership enforcement ─────────────────────────────────────────────

func TestOwnership_PermissionDenied(t *testing.T) {
	store := newFakeStore()
	svc := newSvc(store, wideCaps(), &fakeLedger{})
	ctxA := ctxWithUser(t, "userA")
	ctxB := ctxWithUser(t, "userB")

	created, err := svc.CreateWatchlist(ctxA, &portfoliov1.CreateWatchlistRequest{Name: "A-list"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.Watchlist.WatchlistId

	if _, err := svc.GetWatchlist(ctxB, &portfoliov1.GetWatchlistRequest{WatchlistId: id}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("get as B: want PermissionDenied, got %v", err)
	}
	if _, err := svc.UpdateWatchlist(ctxB, &portfoliov1.UpdateWatchlistRequest{WatchlistId: id, Name: "x"}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("update as B: want PermissionDenied, got %v", err)
	}
	if _, err := svc.DeleteWatchlist(ctxB, &portfoliov1.DeleteWatchlistRequest{WatchlistId: id}); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("delete as B: want PermissionDenied, got %v", err)
	}
}

func TestGetMissing_NotFound(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "userA")
	if _, err := svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: "nope"}); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("want NotFound, got %v", err)
	}
}

func TestMissingUserID_InvalidArgument(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	if _, err := svc.CreateWatchlist(context.Background(), &portfoliov1.CreateWatchlistRequest{Name: "x"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument, got %v", err)
	}
}

// ─── AC-3: caps ──────────────────────────────────────────────────────────────

func TestSymbolCap_InvalidArgument(t *testing.T) {
	cfg := &fakeConfig{vals: map[string]int64{
		"portfolio.watchlist.max_per_user":         1000,
		"portfolio.watchlist.max_symbols_per_list": 2,
	}}
	svc := newSvc(newFakeStore(), cfg, &fakeLedger{})
	ctx := ctxWithUser(t, "userA")
	if _, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{
		Name: "Too big", Symbols: []string{"A", "B", "C"},
	}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument (symbol cap), got %v", err)
	}
}

func TestPerUserCap_InvalidArgument(t *testing.T) {
	cfg := &fakeConfig{vals: map[string]int64{
		"portfolio.watchlist.max_per_user":         1,
		"portfolio.watchlist.max_symbols_per_list": 1000,
	}}
	svc := newSvc(newFakeStore(), cfg, &fakeLedger{})
	ctx := ctxWithUser(t, "userA")
	if _, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "one"}); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "two"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument (per-user cap), got %v", err)
	}
}

// TestAddSymbolsCap_HonoredAfterLowering proves the cap is re-read from config on
// each mutation: a higher cap allows the add, a lowered cap rejects the next one.
func TestAddSymbolsCap_HonoredAfterLowering(t *testing.T) {
	cfg := &fakeConfig{vals: map[string]int64{
		"portfolio.watchlist.max_per_user":         1000,
		"portfolio.watchlist.max_symbols_per_list": 5,
	}}
	svc := newSvc(newFakeStore(), cfg, &fakeLedger{})
	ctx := ctxWithUser(t, "userA")
	created, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "L", Symbols: []string{"A", "B"}})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.Watchlist.WatchlistId
	if _, err := svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{WatchlistId: id, Symbols: []string{"C"}}); err != nil {
		t.Fatalf("add under cap: %v", err)
	}
	// Lower the cap below the current size; the next add must be rejected.
	cfg.vals["portfolio.watchlist.max_symbols_per_list"] = 3
	if _, err := svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{WatchlistId: id, Symbols: []string{"D"}}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("want InvalidArgument after lowering cap, got %v", err)
	}
}

// ─── FR-6: ledger failure is non-fatal ───────────────────────────────────────

func TestLedgerFailure_NonFatal(t *testing.T) {
	ledger := &fakeLedger{err: errors.New("ledger down")}
	svc := newSvc(newFakeStore(), wideCaps(), ledger)
	ctx := ctxWithUser(t, "userA")
	if _, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "ok"}); err != nil {
		t.Fatalf("create should succeed despite ledger failure: %v", err)
	}
	if ledger.calls == 0 {
		t.Fatalf("expected ledger emit to be attempted")
	}
}
