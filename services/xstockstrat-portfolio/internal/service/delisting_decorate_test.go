package service

import (
	"context"
	"errors"
	"slices"
	"testing"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

const decorateUser = "user-42"

var enumerationCtx = ctxWithIncoming("x-internal-caller", "analysis-fundsignal")

// newDecorationHarness fills the cache the way production does: one tick against a sync response
// that flags the given symbols.
func newDecorationHarness(flagged ...string) *delistingHarness {
	entries := make([]*marketdatav1.FlaggedSymbol, 0, len(flagged))
	for _, sym := range flagged {
		entries = append(entries, flaggedSymbol(sym, alertReported, false))
	}
	h := newDelistingHarness(syncResp(entries...))
	h.svc.wlCfg = wideCaps()
	h.tick()
	return h
}

func manualBindings(symbols ...string) []*portfoliov1.WatchlistBinding {
	out := make([]*portfoliov1.WatchlistBinding, 0, len(symbols))
	for _, sym := range symbols {
		out = append(out, &portfoliov1.WatchlistBinding{Symbol: sym})
	}
	return out
}

func listByID(t *testing.T, wls []*portfoliov1.Watchlist, id string) *portfoliov1.Watchlist {
	t.Helper()
	for _, wl := range wls {
		if wl.GetWatchlistId() == id {
			return wl
		}
	}
	t.Fatalf("watchlist %s not in the response", id)
	return nil
}

func assertDelisted(t *testing.T, bs []*portfoliov1.WatchlistBinding, symbol string) {
	t.Helper()
	for _, b := range bs {
		if b.GetSymbol() != symbol {
			continue
		}
		d := b.GetDelisted()
		if d.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE || d.GetFirstUnservableDate() != delistedDate {
			t.Fatalf("%s delisted = %v, want NOT_TRADABLE since %s", symbol, d, delistedDate)
		}
		return
	}
	t.Fatalf("%s not in the response bindings", symbol)
}

func assertNotDelisted(t *testing.T, bs []*portfoliov1.WatchlistBinding, symbol string) {
	t.Helper()
	for _, b := range bs {
		if b.GetSymbol() == symbol {
			if b.GetDelisted() != nil {
				t.Fatalf("%s delisted = %v, want unset", symbol, b.GetDelisted())
			}
			return
		}
	}
	t.Fatalf("%s not in the response bindings", symbol)
}

// C-10(b) parity. A watchlist-returning RPC without a row here is a review failure.
func TestDelistedDecoration_ParityAcrossEveryWatchlistRPC(t *testing.T) {
	type call func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding
	rows := []struct {
		rpc     string
		prepare func(h *delistingHarness)
		call    call
	}{
		{"CreateWatchlist", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.CreateWatchlist(ctx, &portfoliov1.CreateWatchlistRequest{Name: "New", Symbols: []string{"ROKU", "AAPL"}})
			if err != nil {
				t.Fatalf("CreateWatchlist: %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"EnsureSignalWatchlist", func(h *delistingHarness) {
			seedWatchlist(h.store, wl351B, decorateUser, true, manualBindings("ROKU", "AAPL"))
		}, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.EnsureSignalWatchlist(ctx, &portfoliov1.EnsureSignalWatchlistRequest{})
			if err != nil {
				t.Fatalf("EnsureSignalWatchlist: %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"GetWatchlist", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: wl351A})
			if err != nil {
				t.Fatalf("GetWatchlist: %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"ListWatchlists (ensure and re-list page)", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.ListWatchlists(ctx, &portfoliov1.ListWatchlistsRequest{})
			if err != nil {
				t.Fatalf("ListWatchlists: %v", err)
			}
			if h.store.ensureCalls != 1 || systemListCount(h.store, decorateUser) != 1 {
				t.Fatalf("ensure calls = %d system lists = %d, want the ensure-and-re-list path", h.store.ensureCalls, systemListCount(h.store, decorateUser))
			}
			return listByID(t, resp.GetWatchlists(), wl351A).GetBindings()
		}},
		{"ListWatchlists (fail-open page)", func(h *delistingHarness) { h.store.ensureErr = errors.New("ensure down") },
			func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
				resp, err := h.svc.ListWatchlists(ctx, &portfoliov1.ListWatchlistsRequest{})
				if err != nil {
					t.Fatalf("ListWatchlists: %v", err)
				}
				return listByID(t, resp.GetWatchlists(), wl351A).GetBindings()
			}},
		{"UpdateWatchlist (update_mask)", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.UpdateWatchlist(ctx, &portfoliov1.UpdateWatchlistRequest{
				WatchlistId: wl351A, Name: "Renamed", UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"name"}}})
			if err != nil {
				t.Fatalf("UpdateWatchlist (mask): %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"UpdateWatchlist (replace-all)", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.UpdateWatchlist(ctx, &portfoliov1.UpdateWatchlistRequest{
				WatchlistId: wl351A, Name: "Tech", Symbols: []string{"ROKU", "AAPL"}})
			if err != nil {
				t.Fatalf("UpdateWatchlist (replace-all): %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"UpdateWatchlistBinding", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			var out []*portfoliov1.WatchlistBinding
			for _, sym := range []string{"ROKU", "AAPL"} {
				resp, err := h.svc.UpdateWatchlistBinding(ctx, &portfoliov1.UpdateWatchlistBindingRequest{
					WatchlistId: wl351A, Symbol: sym, StrategyId: "strat-1"})
				if err != nil {
					t.Fatalf("UpdateWatchlistBinding(%s): %v", sym, err)
				}
				out = append(out, resp.GetBinding())
			}
			return out
		}},
		{"UpdateWatchlistBindings", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.UpdateWatchlistBindings(ctx, &portfoliov1.UpdateWatchlistBindingsRequest{
				WatchlistId: wl351A, Symbols: []string{"ROKU", "AAPL"}, StrategyId: "strat-1"})
			if err != nil {
				t.Fatalf("UpdateWatchlistBindings: %v", err)
			}
			return resp.GetBindings()
		}},
		{"AddWatchlistSymbols", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{WatchlistId: wl351A, Symbols: []string{"MSFT"}})
			if err != nil {
				t.Fatalf("AddWatchlistSymbols: %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"AddWatchlistSymbols (every symbol refused)", func(h *delistingHarness) {
			h.md.unservable = map[string]commonv1.UnservableReason{"OTCX": commonv1.UnservableReason_UNSERVABLE_REASON_OTC}
			h.md.servabilityLoaded = true
		}, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.AddWatchlistSymbols(ctx, &portfoliov1.AddWatchlistSymbolsRequest{WatchlistId: wl351A, Symbols: []string{"OTCX"}})
			if err != nil {
				t.Fatalf("AddWatchlistSymbols (refused): %v", err)
			}
			if len(resp.GetRefusedSymbols()) != 1 || h.store.addSymbolsCnt != 0 {
				t.Fatalf("refused = %v store adds = %d, want the nothing-to-add return", resp.GetRefusedSymbols(), h.store.addSymbolsCnt)
			}
			return resp.GetWatchlist().GetBindings()
		}},
		{"RemoveWatchlistSymbols", nil, func(t *testing.T, h *delistingHarness, ctx context.Context) []*portfoliov1.WatchlistBinding {
			resp, err := h.svc.RemoveWatchlistSymbols(ctx, &portfoliov1.RemoveWatchlistSymbolsRequest{WatchlistId: wl351A, Symbols: []string{"TSLA"}})
			if err != nil {
				t.Fatalf("RemoveWatchlistSymbols: %v", err)
			}
			return resp.GetWatchlist().GetBindings()
		}},
	}
	for _, row := range rows {
		t.Run(row.rpc, func(t *testing.T) {
			h := newDecorationHarness("ROKU")
			seedWatchlist(h.store, wl351A, decorateUser, false, manualBindings("ROKU", "AAPL", "TSLA"))
			if row.prepare != nil {
				row.prepare(h)
			}
			bs := row.call(t, h, ctxWithUser(t, decorateUser))
			assertDelisted(t, bs, "ROKU")
			assertNotDelisted(t, bs, "AAPL")
		})
	}
}

// @AC-7
func TestDelistedDecoration_AC7_UserListKeepsTheMarkedSymbolUntilTheUserRemovesIt(t *testing.T) {
	h := newDecorationHarness("ROKU")
	seedWatchlist(h.store, wl351A, decorateUser, false, manualBindings("ROKU", "AAPL"))
	ctx := ctxWithUser(t, decorateUser)

	got, err := h.svc.GetWatchlist(ctx, &portfoliov1.GetWatchlistRequest{WatchlistId: wl351A})
	if err != nil {
		t.Fatalf("GetWatchlist: %v", err)
	}
	assertDelisted(t, got.GetWatchlist().GetBindings(), "ROKU")

	removed, err := h.svc.RemoveWatchlistSymbols(ctx, &portfoliov1.RemoveWatchlistSymbolsRequest{WatchlistId: wl351A, Symbols: []string{"ROKU"}})
	if err != nil {
		t.Fatalf("RemoveWatchlistSymbols: %v", err)
	}
	if bs := removed.GetWatchlist().GetBindings(); len(bs) != 1 || bs[0].GetSymbol() != "AAPL" {
		t.Fatalf("bindings after the user's removal = %v, want only AAPL", bs)
	}
}

// @AC-19
func TestDelistedDecoration_AC19_EveryUsersListCarriesTheSameState(t *testing.T) {
	h := newDecorationHarness("ROKU")
	seedWatchlist(h.store, wl351A, "user-a", false, manualBindings("ROKU"))
	seedWatchlist(h.store, wl351B, "user-b", false, manualBindings("ROKU"))

	var states []*commonv1.DelistedState
	for user, id := range map[string]string{"user-a": wl351A, "user-b": wl351B} {
		resp, err := h.svc.ListWatchlists(ctxWithUser(t, user), &portfoliov1.ListWatchlistsRequest{})
		if err != nil {
			t.Fatalf("ListWatchlists(%s): %v", user, err)
		}
		bs := listByID(t, resp.GetWatchlists(), id).GetBindings()
		assertDelisted(t, bs, "ROKU")
		states = append(states, bs[0].GetDelisted())
	}
	if !proto.Equal(states[0], states[1]) {
		t.Fatalf("states differ across users: %v vs %v", states[0], states[1])
	}
}

// @AC-16
func TestDelistedDecoration_AC16_AddResponseCarriesTheStateOfAnExistingSymbol(t *testing.T) {
	h := newDecorationHarness("ROKU")
	seedWatchlist(h.store, wl351A, decorateUser, false, manualBindings("ROKU"))

	resp, err := h.svc.AddWatchlistSymbols(ctxWithUser(t, decorateUser),
		&portfoliov1.AddWatchlistSymbolsRequest{WatchlistId: wl351A, Symbols: []string{"MSFT"}})
	if err != nil {
		t.Fatalf("AddWatchlistSymbols: %v", err)
	}
	assertDelisted(t, resp.GetWatchlist().GetBindings(), "ROKU")
	assertNotDelisted(t, resp.GetWatchlist().GetBindings(), "MSFT")
}

// @AC-8
func TestDelistedDecoration_ListAllWatchlistSymbols_AC8_OmitsFlaggedButTheTickStillSendsIt(t *testing.T) {
	h := newDecorationHarness("ROKU")
	h.store.allSymbols = []string{"AAPL", "ROKU"}

	resp, err := h.svc.ListAllWatchlistSymbols(enumerationCtx, &portfoliov1.ListAllWatchlistSymbolsRequest{})
	if err != nil {
		t.Fatalf("ListAllWatchlistSymbols: %v", err)
	}
	if got := resp.GetSymbols(); !slices.Equal(got, []string{"AAPL"}) {
		t.Fatalf("enumeration = %v, want [AAPL] (flagged ROKU omitted)", got)
	}

	h.tick()
	if got := h.md.syncReqs[len(h.md.syncReqs)-1].GetSymbols(); !slices.Equal(got, []string{"AAPL", "ROKU"}) {
		t.Fatalf("next tick's sync symbols = %v, want ROKU still sent", got)
	}
}

// @AC-4
func TestDelistedDecoration_AC4_RecoveredSymbolLosesTheMarkerAndReturnsToTheEnumeration(t *testing.T) {
	h := newDecorationHarness("ROKU")
	h.md.syncResps = append(h.md.syncResps, syncResp())
	h.store.allSymbols = []string{"AAPL", "ROKU"}
	seedWatchlist(h.store, wl351A, decorateUser, false, manualBindings("ROKU", "AAPL"))
	ctx := ctxWithUser(t, decorateUser)

	listed := func() []*portfoliov1.WatchlistBinding {
		resp, err := h.svc.ListWatchlists(ctx, &portfoliov1.ListWatchlistsRequest{})
		if err != nil {
			t.Fatalf("ListWatchlists: %v", err)
		}
		return listByID(t, resp.GetWatchlists(), wl351A).GetBindings()
	}
	enumerated := func() []string {
		resp, err := h.svc.ListAllWatchlistSymbols(enumerationCtx, &portfoliov1.ListAllWatchlistSymbolsRequest{})
		if err != nil {
			t.Fatalf("ListAllWatchlistSymbols: %v", err)
		}
		return resp.GetSymbols()
	}

	assertDelisted(t, listed(), "ROKU")
	if got := enumerated(); slices.Contains(got, "ROKU") {
		t.Fatalf("enumeration while flagged = %v, want ROKU omitted", got)
	}

	h.tick()
	assertNotDelisted(t, listed(), "ROKU")
	if got := enumerated(); !slices.Equal(got, []string{"AAPL", "ROKU"}) {
		t.Fatalf("enumeration after recovery = %v, want ROKU back", got)
	}
}

func TestDelistedDecoration_CallerSuppliedStateIsNeverEchoed(t *testing.T) {
	forged := &commonv1.DelistedState{Reason: commonv1.UnservableReason_UNSERVABLE_REASON_OTC, FirstUnservableDate: "2020-01-01"}

	t.Run("unflagged symbol", func(t *testing.T) {
		h := newDecorationHarness("ROKU")
		resp, err := h.svc.CreateWatchlist(ctxWithUser(t, decorateUser), &portfoliov1.CreateWatchlistRequest{
			Name: "New", Bindings: []*portfoliov1.WatchlistBinding{{Symbol: "AAPL", Delisted: forged}}})
		if err != nil {
			t.Fatalf("CreateWatchlist: %v", err)
		}
		assertNotDelisted(t, resp.GetWatchlist().GetBindings(), "AAPL")
	})
	t.Run("empty cache decorates nothing", func(t *testing.T) {
		h := newDecorationHarness()
		seedWatchlist(h.store, wl351A, decorateUser, false, []*portfoliov1.WatchlistBinding{{Symbol: "ROKU", Delisted: forged}, {Symbol: "AAPL"}})
		resp, err := h.svc.GetWatchlist(ctxWithUser(t, decorateUser), &portfoliov1.GetWatchlistRequest{WatchlistId: wl351A})
		if err != nil {
			t.Fatalf("GetWatchlist: %v", err)
		}
		assertNotDelisted(t, resp.GetWatchlist().GetBindings(), "ROKU")
		assertNotDelisted(t, resp.GetWatchlist().GetBindings(), "AAPL")
	})
}

// @AC-10 (guard): passes today; fails only if a valuation path starts consulting the delisted cache.
func TestDelistedDecoration_AC10_FlaggedPositionKeepsItsMark(t *testing.T) {
	const nwe = "NWE"
	value := func() *portfoliov1.Position {
		p := offPos(nwe, 10, 45)
		valuationCase{now: testdata.ReadLive, positions: []*portfoliov1.Position{p},
			quotes: []*marketdatav1.Quote{testdata.LiveQuote(nwe, testdata.NewcoMid)}}.run()
		return p
	}
	before := value()
	h := newDecorationHarness(nwe)
	if !h.cached(nwe) {
		t.Fatal("cache does not hold NWE")
	}
	after := value()
	if after.GetMarkSource() != portfoliov1.MarkSource_MARK_SOURCE_QUOTE || after.GetCurrentPrice() != testdata.NewcoMid {
		t.Fatalf("flagged position mark = %v @ %v, want the live quote", after.GetMarkSource(), after.GetCurrentPrice())
	}
	if !proto.Equal(before, after) {
		t.Fatalf("valuation changed once NWE was flagged:\n before %v\n after  %v", before, after)
	}
}
