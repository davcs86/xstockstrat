package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

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
	// feature 154: cross-user enumeration return (the store/SQL layer owns the
	// DISTINCT dedup; the service just passes this through).
	allSymbols    []string
	allSymbolsErr error
}

func newFakeStore() *fakeWatchlistStore {
	return &fakeWatchlistStore{byID: map[string]*portfoliov1.Watchlist{}}
}

// ListAllSymbols returns the configured cross-user union (feature 154).
func (f *fakeWatchlistStore) ListAllSymbols(_ context.Context) ([]string, error) {
	return f.allSymbols, f.allSymbolsErr
}

func clone(wl *portfoliov1.Watchlist) *portfoliov1.Watchlist {
	return proto.Clone(wl).(*portfoliov1.Watchlist)
}

// fakeSymbols mirrors bindings to the flat symbols list (as the repo does).
func fakeSymbols(binds []*portfoliov1.WatchlistBinding) []string {
	if len(binds) == 0 {
		return nil
	}
	out := make([]string, 0, len(binds))
	for _, b := range binds {
		out = append(out, b.GetSymbol())
	}
	return out
}

// setBindings stores bindings and keeps the flat symbols mirror in sync.
func setBindings(wl *portfoliov1.Watchlist, binds []*portfoliov1.WatchlistBinding) {
	wl.Bindings = binds
	wl.Symbols = fakeSymbols(binds) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
}

func (f *fakeWatchlistStore) Create(_ context.Context, userID, name, description string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	f.seq++
	id := fmt.Sprintf("wl-%d", f.seq)
	wl := &portfoliov1.Watchlist{WatchlistId: id, UserId: userID, Name: name, Description: description}
	setBindings(wl, append([]*portfoliov1.WatchlistBinding{}, bindings...))
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

func (f *fakeWatchlistStore) Update(_ context.Context, watchlistID, name, description string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	wl.Name, wl.Description = name, description
	setBindings(wl, append([]*portfoliov1.WatchlistBinding{}, bindings...))
	return clone(wl), nil
}

func (f *fakeWatchlistStore) Delete(_ context.Context, watchlistID string) error {
	if _, ok := f.byID[watchlistID]; !ok {
		return repository.ErrWatchlistNotFound
	}
	delete(f.byID, watchlistID)
	return nil
}

func (f *fakeWatchlistStore) AddSymbols(_ context.Context, watchlistID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, repository.ErrWatchlistNotFound
	}
	seen := map[string]struct{}{}
	for _, b := range wl.Bindings {
		seen[b.GetSymbol()] = struct{}{}
	}
	// ON CONFLICT DO NOTHING: an existing symbol keeps its stored strategy_id (fails-080).
	for _, b := range bindings {
		if _, dup := seen[b.GetSymbol()]; !dup {
			wl.Bindings = append(wl.Bindings, &portfoliov1.WatchlistBinding{Symbol: b.GetSymbol(), StrategyId: b.GetStrategyId(), Source: b.GetSource()})
			seen[b.GetSymbol()] = struct{}{}
		}
	}
	wl.Symbols = fakeSymbols(wl.Bindings) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
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
	kept := wl.Bindings[:0]
	for _, b := range wl.Bindings {
		if _, d := drop[b.GetSymbol()]; !d {
			kept = append(kept, b)
		}
	}
	wl.Bindings = kept
	wl.Symbols = fakeSymbols(wl.Bindings) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
	return clone(wl), nil
}

// UpdateBinding models the repo's single-row UPDATE ... RETURNING semantics (feature 167): a matched
// symbol has ONLY its strategy_id rewritten (source untouched — the fails-080 reset trap is
// structurally impossible), and returns the (possibly value-unchanged) row; an unmatched symbol
// returns ErrBindingNotFound. Postgres counts a WHERE-matched row regardless of value change.
func (f *fakeWatchlistStore) UpdateBinding(_ context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error) {
	wl, ok := f.byID[watchlistID]
	if !ok {
		return nil, time.Time{}, repository.ErrWatchlistNotFound // defensive; loadOwned already guarded
	}
	for _, b := range wl.Bindings {
		if b.GetSymbol() == symbol { // WHERE-match: matched regardless of value change
			b.StrategyId = strategyID // single-column update; Source untouched (models RETURNING source)
			return &portfoliov1.WatchlistBinding{Symbol: b.GetSymbol(), StrategyId: strategyID, Source: b.GetSource()}, time.Now(), nil
		}
	}
	return nil, time.Time{}, repository.ErrBindingNotFound // AC-3
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

// EnsureSystemManaged returns the user's single system-managed list, creating it on
// first call. Mirrors the repo's one-system-list-per-user invariant (migration 011).
func (f *fakeWatchlistStore) EnsureSystemManaged(_ context.Context, userID, defaultName string) (*portfoliov1.Watchlist, error) {
	for _, wl := range f.byID {
		if wl.UserId == userID && wl.GetSystemManaged() {
			return clone(wl), nil
		}
	}
	f.seq++
	id := fmt.Sprintf("wl-%d", f.seq)
	wl := &portfoliov1.Watchlist{WatchlistId: id, UserId: userID, Name: defaultName, SystemManaged: true}
	f.byID[id] = wl
	return clone(wl), nil
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

// ctxWithIncoming builds a context carrying raw incoming gRPC metadata (feature 154).
// The x-internal-caller gate reads FromIncomingContext directly, so tests inject the
// header straight into incoming metadata rather than through the interceptor.
func ctxWithIncoming(pairs ...string) context.Context {
	return metadata.NewIncomingContext(context.Background(), metadata.Pairs(pairs...))
}

// ─── feature 154: ListAllWatchlistSymbols (cross-user enumeration + authz gate) ──

// AC-1: an authorized internal caller gets the store's distinct union passed through.
func TestListAllWatchlistSymbols_Authorized(t *testing.T) {
	store := newFakeStore()
	// alice {AAPL,MSFT} ∪ bob {MSFT,NVDA} → the store/SQL DISTINCT collapses to this set.
	store.allSymbols = []string{"AAPL", "MSFT", "NVDA"}
	svc := newSvc(store, wideCaps(), nil)

	resp, err := svc.ListAllWatchlistSymbols(
		ctxWithIncoming("x-internal-caller", "analysis-fundsignal"),
		&portfoliov1.ListAllWatchlistSymbolsRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got := resp.GetSymbols()
	want := []string{"AAPL", "MSFT", "NVDA"}
	if len(got) != len(want) {
		t.Fatalf("symbols = %v, want %v", got, want)
	}
	seen := map[string]int{}
	for i, s := range got {
		if s != want[i] {
			t.Errorf("symbols[%d] = %q, want %q", i, s, want[i])
		}
		seen[s]++
	}
	if seen["MSFT"] != 1 {
		t.Errorf("MSFT appeared %d times, want exactly 1", seen["MSFT"])
	}
}

// AC-2: the gate fails closed for every non-privileged caller, and ignores the admin bit.
func TestListAllWatchlistSymbols_FailClosed(t *testing.T) {
	cases := []struct {
		name string
		ctx  context.Context
	}{
		{"no incoming metadata", context.Background()},
		{"metadata without x-internal-caller", ctxWithIncoming("x-user-id", "u1")},
		{"unlisted callerID", ctxWithIncoming("x-internal-caller", "someone-else")},
		{"admin-bit-only, no internal-caller", ctxWithIncoming("x-access-scope", "4")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := newFakeStore()
			store.allSymbols = []string{"AAPL"} // would leak if the gate let it through
			svc := newSvc(store, wideCaps(), nil)

			resp, err := svc.ListAllWatchlistSymbols(tc.ctx, &portfoliov1.ListAllWatchlistSymbolsRequest{})
			if err == nil {
				t.Fatalf("expected PermissionDenied, got nil (resp=%v)", resp)
			}
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				t.Fatalf("code = %v, want PermissionDenied", connect.CodeOf(err))
			}
			if resp != nil {
				t.Fatalf("resp = %v, want nil", resp)
			}
		})
	}
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
	if got := created.Watchlist.Symbols; len(got) != 2 || got[0] != "AAPL" || got[1] != "MSFT" { //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
		t.Fatalf("symbols not normalized: %v", got)
	}
	got, err := svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: created.Watchlist.WatchlistId})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Watchlist.Name != "Tech" || len(got.Watchlist.Symbols) != 2 { //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
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

// ─── feature 097: (symbol, strategy) bindings ────────────────────────────────

func bindingFor(t *testing.T, wl *portfoliov1.Watchlist, symbol string) *portfoliov1.WatchlistBinding {
	t.Helper()
	for _, b := range wl.GetBindings() {
		if b.GetSymbol() == symbol {
			return b
		}
	}
	t.Fatalf("no binding for %q in %v", symbol, wl.GetBindings())
	return nil
}

// Create with bindings round-trips the strategy_id and mirrors the flat symbols list.
func TestBindings_CreateGetRoundTrip(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "userA")

	created, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{
		Name: "Bound",
		Bindings: []*portfoliov1.WatchlistBinding{
			{Symbol: "aapl", StrategyId: "strat-x"},
			{Symbol: "MSFT"},
		},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: created.Watchlist.WatchlistId})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if b := bindingFor(t, got.Watchlist, "AAPL"); b.GetStrategyId() != "strat-x" {
		t.Fatalf("AAPL strategy_id: got %q want strat-x", b.GetStrategyId())
	}
	if b := bindingFor(t, got.Watchlist, "MSFT"); b.GetStrategyId() != "" {
		t.Fatalf("MSFT strategy_id: got %q want unbound", b.GetStrategyId())
	}
	if syms := got.Watchlist.GetSymbols(); len(syms) != 2 || syms[0] != "AAPL" || syms[1] != "MSFT" { //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
		t.Fatalf("flat symbols mirror: got %v want [AAPL MSFT]", syms)
	}
}

// fails-080 regression: a legacy flat `symbols` add must not clear a prior binding's strategy_id.
func TestBindings_LegacyAddDoesNotClearStrategy(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "userA")

	created, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "L"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.Watchlist.WatchlistId

	if _, err := svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{
		WatchlistId: id,
		Bindings:    []*portfoliov1.WatchlistBinding{{Symbol: "AAPL", StrategyId: "strat-x"}},
	}); err != nil {
		t.Fatalf("add bound: %v", err)
	}
	// Legacy flat write of a different symbol must leave AAPL's binding intact.
	after, err := svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{
		WatchlistId: id, Symbols: []string{"MSFT"},
	})
	if err != nil {
		t.Fatalf("add flat: %v", err)
	}
	if b := bindingFor(t, after.Watchlist, "AAPL"); b.GetStrategyId() != "strat-x" {
		t.Fatalf("080-trap: AAPL strategy_id cleared by legacy add: got %q want strat-x", b.GetStrategyId())
	}
}

// Update replaces the full binding set.
func TestBindings_UpdateReplaces(t *testing.T) {
	svc := newSvc(newFakeStore(), wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "userA")

	created, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{
		Name: "R", Bindings: []*portfoliov1.WatchlistBinding{{Symbol: "AAPL", StrategyId: "strat-x"}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	updated, err := svc.UpdateWatchlist(ctx, &portfoliov1.UpdateWatchlistRequest{
		WatchlistId: created.Watchlist.WatchlistId, Name: "R",
		Bindings: []*portfoliov1.WatchlistBinding{{Symbol: "NVDA", StrategyId: "strat-y"}},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if syms := updated.Watchlist.GetSymbols(); len(syms) != 1 || syms[0] != "NVDA" { //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
		t.Fatalf("update replace: got %v want [NVDA]", syms)
	}
	if b := bindingFor(t, updated.Watchlist, "NVDA"); b.GetStrategyId() != "strat-y" {
		t.Fatalf("NVDA strategy_id: got %q want strat-y", b.GetStrategyId())
	}
}

// ─── AC-6: EnsureSignalWatchlist idempotent + coexists with a same-named manual list ──

func TestEnsureSignalWatchlist_Idempotent(t *testing.T) {
	store := newFakeStore()
	svc := newSvc(store, wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "user-42")

	// A pre-existing manual list literally named "Signals" must not collide with the
	// system list (the system list is identified by the flag, not the name).
	if _, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: signalWatchlistDefaultName}); err != nil {
		t.Fatalf("seed manual Signals list: %v", err)
	}

	first, err := svc.EnsureSignalWatchlist(ctx, &portfoliov1.EnsureSignalWatchlistRequest{})
	if err != nil {
		t.Fatalf("ensure #1: %v", err)
	}
	second, err := svc.EnsureSignalWatchlist(ctx, &portfoliov1.EnsureSignalWatchlistRequest{})
	if err != nil {
		t.Fatalf("ensure #2: %v", err)
	}
	if first.Watchlist.GetWatchlistId() != second.Watchlist.GetWatchlistId() {
		t.Fatalf("not idempotent: %q != %q", first.Watchlist.GetWatchlistId(), second.Watchlist.GetWatchlistId())
	}
	if !first.Watchlist.GetSystemManaged() {
		t.Fatalf("returned watchlist is not system_managed")
	}
	// Exactly one system-managed row for the user, coexisting with the manual "Signals".
	systemCount := 0
	for _, wl := range store.byID {
		if wl.UserId == "user-42" && wl.GetSystemManaged() {
			systemCount++
		}
	}
	if systemCount != 1 {
		t.Fatalf("expected exactly 1 system-managed list, got %d", systemCount)
	}
}

// ─── AC-7 (API half): a system-managed watchlist cannot be deleted ───────────────────

func TestDeleteWatchlist_SystemManagedGuard(t *testing.T) {
	store := newFakeStore()
	svc := newSvc(store, wideCaps(), &fakeLedger{})
	ctx := ctxWithUser(t, "user-42")

	ensured, err := svc.EnsureSignalWatchlist(ctx, &portfoliov1.EnsureSignalWatchlistRequest{})
	if err != nil {
		t.Fatalf("ensure: %v", err)
	}
	sysID := ensured.Watchlist.GetWatchlistId()

	_, err = svc.DeleteWatchlist(ctx, &portfoliov1.DeleteWatchlistRequest{WatchlistId: sysID})
	if err == nil {
		t.Fatalf("expected delete of system-managed list to fail")
	}
	if got := connect.CodeOf(err); got != connect.CodeFailedPrecondition {
		t.Fatalf("delete guard code: got %v want FailedPrecondition", got)
	}
	if _, ok := store.byID[sysID]; !ok {
		t.Fatalf("system-managed row was deleted despite the guard")
	}

	// Guard has teeth but does not block ordinary deletes.
	manual, err := svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "Tech"})
	if err != nil {
		t.Fatalf("create manual: %v", err)
	}
	if _, err := svc.DeleteWatchlist(ctx, &portfoliov1.DeleteWatchlistRequest{WatchlistId: manual.Watchlist.GetWatchlistId()}); err != nil {
		t.Fatalf("manual delete should succeed: %v", err)
	}
}

// ─── feature 167: UpdateWatchlistBinding (targeted single-symbol rebind) ──────

// seedWatchlist inserts a watchlist owned by userID with the given bindings directly into the fake
// store (bypassing Create so per-binding Source and the list-level SystemManaged flag can be set).
func seedWatchlist(store *fakeWatchlistStore, id, userID string, systemManaged bool, binds []*portfoliov1.WatchlistBinding) {
	wl := &portfoliov1.Watchlist{WatchlistId: id, UserId: userID, SystemManaged: systemManaged}
	setBindings(wl, binds)
	store.byID[id] = wl
}

// storeBinding returns the stored binding for a symbol, or nil if absent (non-fatal — AC-3 asserts
// absence). Distinct from the fatal feature-097 bindingFor helper.
func storeBinding(store *fakeWatchlistStore, id, symbol string) *portfoliov1.WatchlistBinding {
	for _, b := range store.byID[id].GetBindings() {
		if b.GetSymbol() == symbol {
			return b
		}
	}
	return nil
}

// AC-1: rebinding one symbol changes only that row; the others are untouched (no replace-all).
func TestUpdateWatchlistBinding_RebindsOneSymbol(t *testing.T) {
	store := newFakeStore()
	seedWatchlist(store, "wl-1", "u-1", false, []*portfoliov1.WatchlistBinding{
		{Symbol: "AAPL", StrategyId: "sma_cross"},
		{Symbol: "MSFT", StrategyId: "macd"},
		{Symbol: "TSLA", StrategyId: "rsi"},
	})
	svc := newSvc(store, wideCaps(), &fakeLedger{})

	resp, err := svc.UpdateWatchlistBinding(ctxWithUser(t, "u-1"), &portfoliov1.UpdateWatchlistBindingRequest{
		WatchlistId: "wl-1", Symbol: "MSFT", StrategyId: "fundamentals_macd_blend",
	})
	if err != nil {
		t.Fatalf("rebind: %v", err)
	}
	if got := resp.GetBinding(); got.GetSymbol() != "MSFT" || got.GetStrategyId() != "fundamentals_macd_blend" {
		t.Fatalf("response binding = %+v, want MSFT->fundamentals_macd_blend", got)
	}
	if got := storeBinding(store, "wl-1", "MSFT").GetStrategyId(); got != "fundamentals_macd_blend" {
		t.Errorf("stored MSFT strategy_id = %q, want fundamentals_macd_blend", got)
	}
	// AAPL/TSLA rows are not rewritten by a full-list replace.
	if got := storeBinding(store, "wl-1", "AAPL").GetStrategyId(); got != "sma_cross" {
		t.Errorf("AAPL strategy_id = %q, want unchanged sma_cross", got)
	}
	if got := storeBinding(store, "wl-1", "TSLA").GetStrategyId(); got != "rsi" {
		t.Errorf("TSLA strategy_id = %q, want unchanged rsi", got)
	}
}

// AC-2: a rebind preserves the entry's per-binding source and the list-level system_managed flag.
func TestUpdateWatchlistBinding_PreservesSourceOnSystemManaged(t *testing.T) {
	store := newFakeStore()
	seedWatchlist(store, "wl-1", "u-1", true, []*portfoliov1.WatchlistBinding{
		{Symbol: "NVDA", StrategyId: "macd", Source: portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_SIGNAL},
	})
	svc := newSvc(store, wideCaps(), &fakeLedger{})

	resp, err := svc.UpdateWatchlistBinding(ctxWithUser(t, "u-1"), &portfoliov1.UpdateWatchlistBindingRequest{
		WatchlistId: "wl-1", Symbol: "NVDA", StrategyId: "sma_cross",
	})
	if err != nil {
		t.Fatalf("rebind: %v", err)
	}
	if got := resp.GetBinding().GetStrategyId(); got != "sma_cross" {
		t.Errorf("NVDA strategy_id = %q, want sma_cross", got)
	}
	if got := resp.GetBinding().GetSource(); got != portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_SIGNAL {
		t.Errorf("NVDA source = %v, want SIGNAL (preserved)", got)
	}
	if !store.byID["wl-1"].GetSystemManaged() {
		t.Errorf("list system_managed flag was cleared, want still true")
	}
}

// AC-3: rebinding a symbol not in the list is NOT_FOUND and does not insert a row.
func TestUpdateWatchlistBinding_AbsentSymbolNotFound(t *testing.T) {
	store := newFakeStore()
	seedWatchlist(store, "wl-1", "u-1", false, []*portfoliov1.WatchlistBinding{
		{Symbol: "AAPL", StrategyId: "sma_cross"},
	})
	svc := newSvc(store, wideCaps(), &fakeLedger{})

	_, err := svc.UpdateWatchlistBinding(ctxWithUser(t, "u-1"), &portfoliov1.UpdateWatchlistBindingRequest{
		WatchlistId: "wl-1", Symbol: "GOOG", StrategyId: "macd",
	})
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
	if storeBinding(store, "wl-1", "GOOG") != nil {
		t.Errorf("a GOOG binding was created; rebind must not insert")
	}
}

// AC-4: a non-owner cannot rebind another user's watchlist (loadOwned → PermissionDenied).
func TestUpdateWatchlistBinding_NonOwnerDenied(t *testing.T) {
	store := newFakeStore()
	seedWatchlist(store, "wl-1", "u-1", false, []*portfoliov1.WatchlistBinding{
		{Symbol: "AAPL", StrategyId: "sma_cross"},
	})
	svc := newSvc(store, wideCaps(), &fakeLedger{})

	_, err := svc.UpdateWatchlistBinding(ctxWithUser(t, "u-2"), &portfoliov1.UpdateWatchlistBindingRequest{
		WatchlistId: "wl-1", Symbol: "AAPL", StrategyId: "macd",
	})
	if code := connect.CodeOf(err); code != connect.CodePermissionDenied && code != connect.CodeNotFound {
		t.Fatalf("code = %v, want PermissionDenied or NotFound", code)
	}
	if got := storeBinding(store, "wl-1", "AAPL").GetStrategyId(); got != "sma_cross" {
		t.Errorf("AAPL strategy_id = %q, want unchanged sma_cross", got)
	}
}

// AC-5: an empty strategy_id unbinds only that row; siblings are untouched.
func TestUpdateWatchlistBinding_EmptyStrategyUnbinds(t *testing.T) {
	store := newFakeStore()
	seedWatchlist(store, "wl-1", "u-1", false, []*portfoliov1.WatchlistBinding{
		{Symbol: "AAPL", StrategyId: "sma_cross"},
		{Symbol: "MSFT", StrategyId: "macd"},
	})
	svc := newSvc(store, wideCaps(), &fakeLedger{})

	resp, err := svc.UpdateWatchlistBinding(ctxWithUser(t, "u-1"), &portfoliov1.UpdateWatchlistBindingRequest{
		WatchlistId: "wl-1", Symbol: "AAPL", StrategyId: "",
	})
	if err != nil {
		t.Fatalf("unbind: %v", err)
	}
	if got := resp.GetBinding().GetStrategyId(); got != "" {
		t.Errorf("AAPL strategy_id = %q, want \"\" (unbound)", got)
	}
	if got := storeBinding(store, "wl-1", "MSFT").GetStrategyId(); got != "macd" {
		t.Errorf("MSFT strategy_id = %q, want unchanged macd", got)
	}
}
