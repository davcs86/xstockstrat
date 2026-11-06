package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/testdata"
)

const (
	assetUnloadedWarn = "asset set unavailable; treating every symbol as servable"
	assetRejectedWarn = "asset set refresh rejected; keeping last good set"
)

// fakeAssetSource scripts ListAssets responses in order and records the asset class asked for.
type fakeAssetSource struct {
	fakeBackfillSource
	mu      sync.Mutex
	replies []assetReply
	classes []string
}

type assetReply struct {
	assets []*commonv1.Asset
	err    error
}

func (f *fakeAssetSource) ListAssets(_ context.Context, assetClass string) ([]*commonv1.Asset, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.classes = append(f.classes, assetClass)
	if len(f.replies) == 0 {
		return nil, errors.New("no scripted ListAssets reply")
	}
	r := f.replies[0]
	f.replies = f.replies[1:]
	return r.assets, r.err
}

func newAssetSvc(replies ...assetReply) (*MarketDataService, *fakeAssetSource) {
	fake := &fakeAssetSource{replies: replies}
	reg := source.NewRegistry()
	reg.Register("alpaca", fake)
	return &MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}}, fake
}

func withoutSymbol(assets []*commonv1.Asset, sym string) []*commonv1.Asset {
	out := make([]*commonv1.Asset, 0, len(assets))
	for _, a := range assets {
		if a.GetSymbol() != sym {
			out = append(out, a)
		}
	}
	return out
}

func mustRefresh(t *testing.T, svc *MarketDataService) {
	t.Helper()
	if err := svc.refreshAssets(context.Background()); err != nil {
		t.Fatalf("refreshAssets: %v", err)
	}
}

func servabilityBySymbol(t *testing.T, svc *MarketDataService, symbols ...string) (map[string]*marketdatav1.SymbolServability, bool) {
	t.Helper()
	resp, err := svc.GetSymbolServability(context.Background(), &marketdatav1.GetSymbolServabilityRequest{Symbols: symbols})
	if err != nil {
		t.Fatalf("GetSymbolServability: %v", err)
	}
	out := map[string]*marketdatav1.SymbolServability{}
	for _, s := range resp.GetSymbols() {
		out[s.GetSymbol()] = s
	}
	return out, resp.GetAssetSetLoaded()
}

func isWarm(svc *MarketDataService, sym string) bool {
	svc.warmMu.Lock()
	defer svc.warmMu.Unlock()
	_, ok := svc.warmSymbols[sym]
	return ok
}

// @AC-1: a loaded set classifies servable, OTC and absent symbols.
func TestGetSymbolServability_ClassifiesAgainstLoadedSet(t *testing.T) {
	svc, fake := newAssetSvc(assetReply{assets: testdata.ServableAssets()})
	mustRefresh(t, svc)
	if len(fake.classes) != 1 || fake.classes[0] != "us_equity" {
		t.Fatalf("ListAssets asset classes = %v, want [us_equity]", fake.classes)
	}

	got, loaded := servabilityBySymbol(t, svc, testdata.Aapl, testdata.Bossy, testdata.Dnb)
	if !loaded {
		t.Fatal("AssetSetLoaded = false, want true")
	}
	if s := got[testdata.Aapl]; !s.GetServable() || s.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_UNSPECIFIED {
		t.Errorf("AAPL = %v, want servable", s)
	}
	if s := got[testdata.Bossy]; s.GetServable() || s.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_OTC {
		t.Errorf("BOSSY = %v, want unservable OTC", s)
	}
	if s := got[testdata.Dnb]; s.GetServable() || s.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE {
		t.Errorf("DNB = %v, want unservable NOT_TRADABLE", s)
	}
}

// @AC-23: symbols are normalized (trim + uppercase) before classification.
func TestAssetServability_NormalizesSymbols(t *testing.T) {
	svc, _ := newAssetSvc(assetReply{assets: testdata.ServableAssets()})
	mustRefresh(t, svc)
	raw := " " + strings.ToLower(testdata.Bossy) + " "

	got, _ := servabilityBySymbol(t, svc, raw)
	s, ok := got[testdata.Bossy]
	if !ok || s.GetServable() || s.GetReason() != commonv1.UnservableReason_UNSERVABLE_REASON_OTC {
		t.Fatalf("GetSymbolServability(%q) = %v, want BOSSY unservable OTC", raw, got)
	}
	snap := svc.assets.snap.Load()
	if servable, reason := snap.classify(raw); servable || reason != commonv1.UnservableReason_UNSERVABLE_REASON_OTC {
		t.Errorf("classify(%q) = %v, %v; want false, OTC", raw, servable, reason)
	}
	if snap.servable(raw) {
		t.Errorf("servable(%q) = true, want false", raw)
	}
}

// @AC-4 / @AC-7 (decision half): the live-fetch predicate refuses OTC and absent symbols; nil fails open.
func TestLiveFetchAllowed(t *testing.T) {
	svc, _ := newAssetSvc(assetReply{assets: testdata.ServableAssets()})
	mustRefresh(t, svc)
	snap := svc.assets.snap.Load()

	if liveFetchAllowed(snap, testdata.Bossy) {
		t.Error("liveFetchAllowed(BOSSY) = true, want false (OTC)")
	}
	if liveFetchAllowed(snap, testdata.Dnb) {
		t.Error("liveFetchAllowed(DNB) = true, want false (not tradable)")
	}
	if !liveFetchAllowed(snap, testdata.Aapl) {
		t.Error("liveFetchAllowed(AAPL) = false, want true")
	}
	if !liveFetchAllowed(nil, testdata.Bossy) {
		t.Error("liveFetchAllowed(nil, BOSSY) = false, want true (fail open)")
	}
}

// @AC-22 (marketdata half): more than 1000 symbols is InvalidArgument; exactly 1000 succeeds.
func TestGetSymbolServability_SymbolBound(t *testing.T) {
	svc, _ := newAssetSvc()
	symbols := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("SYM%04d", i)
		}
		return out
	}

	_, err := svc.GetSymbolServability(context.Background(), &marketdatav1.GetSymbolServabilityRequest{Symbols: symbols(1001)})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("1001 symbols: code = %v (err %v), want InvalidArgument", connect.CodeOf(err), err)
	}
	resp, err := svc.GetSymbolServability(context.Background(), &marketdatav1.GetSymbolServabilityRequest{Symbols: symbols(1000)})
	if err != nil {
		t.Fatalf("1000 symbols: %v", err)
	}
	if len(resp.GetSymbols()) != 1000 {
		t.Errorf("1000 symbols: got %d results", len(resp.GetSymbols()))
	}
}

// @AC-9: an unloaded set fails open and warns once on entering the unloaded state.
func TestAssetSet_UnloadedFailsOpenAndWarnsOnce(t *testing.T) {
	warns := installWarnRecorder(t)
	svc, _ := newAssetSvc()

	got, loaded := servabilityBySymbol(t, svc, testdata.Bossy, testdata.Dnb)
	if loaded {
		t.Error("AssetSetLoaded = true, want false")
	}
	for sym, s := range got {
		if !s.GetServable() {
			t.Errorf("%s servable = false while unloaded, want true", sym)
		}
	}
	if snap := svc.markWarmIfServable(testdata.Bossy); snap != nil {
		t.Errorf("markWarmIfServable snapshot = %v, want nil", snap)
	}
	if !isWarm(svc, testdata.Bossy) {
		t.Error("BOSSY not warmed while unloaded")
	}
	for i := 0; i < 5; i++ {
		svc.noteAssetRefreshFailure(context.Background(), errors.New("alpaca down"))
	}
	if n := warns.count(assetUnloadedWarn); n != 1 {
		t.Errorf("unloaded WARN count = %d, want 1", n)
	}
}

// @AC-10: a failed refresh keeps the last good set; the retry delay backs off to a 30m cap.
func TestAssetSet_FailedRefreshKeepsLastGoodSet(t *testing.T) {
	svc, _ := newAssetSvc(
		assetReply{assets: testdata.ServableAssets()},
		assetReply{err: errors.New("alpaca 500")},
	)
	mustRefresh(t, svc)
	before := svc.assets.snap.Load()

	if err := svc.refreshAssets(context.Background()); err == nil {
		t.Fatal("refreshAssets on ListAssets error = nil, want error")
	}
	after := svc.assets.snap.Load()
	if after != before {
		t.Fatal("snapshot pointer changed after a failed refresh")
	}
	if after.servable(testdata.Bossy) || !after.servable(testdata.Aapl) {
		t.Error("after failed refresh: want BOSSY unservable and AAPL servable")
	}

	want := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 30 * time.Minute, 30 * time.Minute}
	var d time.Duration
	for i, w := range want {
		d = nextAssetRetryDelay(d)
		if d != w {
			t.Fatalf("retry %d: delay = %v, want %v", i+1, d, w)
		}
	}
}

// @AC-11: a refresh below 50% of the last good set, or an empty one, is rejected with a WARN.
func TestAssetSet_ShrinkGuard(t *testing.T) {
	warns := installWarnRecorder(t)
	svc, _ := newAssetSvc(
		assetReply{assets: testdata.SyntheticAssets(10)},
		assetReply{assets: testdata.SyntheticAssets(4)},
		assetReply{assets: nil},
		assetReply{assets: testdata.SyntheticAssets(5)},
	)
	mustRefresh(t, svc)
	good := svc.assets.snap.Load()

	if err := svc.refreshAssets(context.Background()); err == nil || svc.assets.snap.Load() != good {
		t.Fatalf("4-of-10 refresh: err = %v, snapshot replaced = %v; want rejected", err, svc.assets.snap.Load() != good)
	}
	if n := warns.count(assetRejectedWarn); n != 1 {
		t.Errorf("after shrunken refresh: reject WARN count = %d, want 1", n)
	}
	if err := svc.refreshAssets(context.Background()); err == nil || svc.assets.snap.Load() != good {
		t.Fatalf("empty refresh: err = %v; want rejected and last good set kept", err)
	}
	if n := warns.count(assetRejectedWarn); n != 2 {
		t.Errorf("after empty refresh: reject WARN count = %d, want 2", n)
	}
	mustRefresh(t, svc)
	if len(svc.assets.snap.Load().otc) != 5 {
		t.Errorf("5-of-10 refresh: set size = %d, want 5 (exactly 50%% is accepted)", len(svc.assets.snap.Load().otc))
	}
}

// @AC-15: only the first successful load prunes unservable symbols warmed while unloaded.
func TestAssetSet_FirstLoadPrunesWarmSet(t *testing.T) {
	first := withoutSymbol(testdata.ServableAssets(), testdata.Bossy)
	later := withoutSymbol(testdata.ServableAssets(), testdata.Aapl)
	svc, _ := newAssetSvc(assetReply{assets: first}, assetReply{assets: later})
	svc.markWarm(testdata.Bossy)
	svc.markWarm(testdata.Aapl)

	mustRefresh(t, svc)
	if isWarm(svc, testdata.Bossy) {
		t.Error("BOSSY still warm after the first load that does not list it")
	}
	if !isWarm(svc, testdata.Aapl) {
		t.Error("AAPL removed from the warm set by the first load")
	}

	mustRefresh(t, svc)
	if !isWarm(svc, testdata.Aapl) {
		t.Error("a later refresh that stops listing AAPL removed it from the warm set")
	}
}

// @AC-24: the refresh interval is clamped on read.
func TestResolveAssetRefreshInterval(t *testing.T) {
	cases := []struct {
		name string
		cfg  intGetter
		want time.Duration
	}{
		{"zero pauses", fakeIntGetter{assetRefreshHoursKey: 0}, 0},
		{"48 reads as 24", fakeIntGetter{assetRefreshHoursKey: 48}, 24 * time.Hour},
		{"unset reads as 6", fakeIntGetter{}, 6 * time.Hour},
		{"nil cfg reads as 6", nil, 6 * time.Hour},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveAssetRefreshInterval(tc.cfg); got != tc.want {
				t.Errorf("resolveAssetRefreshInterval = %v, want %v", got, tc.want)
			}
		})
	}
}

// Config-key wiring (b): the reader reads exactly the key 038 seeds (literal, not the const).
func TestResolveAssetRefreshInterval_ReadsSeededKey(t *testing.T) {
	cfg := fakeIntGetter{"marketdata.assets.refresh_interval_hours": 12}
	if got := resolveAssetRefreshInterval(cfg); got != 12*time.Hour {
		t.Errorf("resolveAssetRefreshInterval = %v, want 12h", got)
	}
}
