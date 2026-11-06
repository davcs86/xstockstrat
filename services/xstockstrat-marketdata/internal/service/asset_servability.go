package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// Operator-approved fixed invariants (feature 282 design); only the refresh interval is a config key.
const (
	assetClassUSEquity       = "us_equity"
	assetExchangeOTC         = "OTC"
	assetShrinkKeepPercent   = 50
	assetRetryInitial        = time.Minute
	assetRetryMax            = 30 * time.Minute
	servabilityMaxSymbols    = 1000
	defaultAssetRefreshHours = 6
	maxAssetRefreshHours     = 24
	assetRefreshHoursKey     = "marketdata.assets.refresh_interval_hours"
)

// assetSet is immutable after construction: normalized symbol → exchange is OTC.
type assetSet struct {
	otc map[string]bool
}

func newAssetSet(assets []*commonv1.Asset) *assetSet {
	set := &assetSet{otc: make(map[string]bool, len(assets))}
	for _, a := range assets {
		if sym := strings.ToUpper(strings.TrimSpace(a.GetSymbol())); sym != "" {
			set.otc[sym] = strings.EqualFold(a.GetExchange(), assetExchangeOTC)
		}
	}
	return set
}

// classify fails open on a nil receiver (asset set not loaded).
func (a *assetSet) classify(sym string) (bool, commonv1.UnservableReason) {
	if a == nil {
		return true, commonv1.UnservableReason_UNSERVABLE_REASON_UNSPECIFIED
	}
	otc, ok := a.otc[strings.ToUpper(strings.TrimSpace(sym))]
	switch {
	case !ok:
		return false, commonv1.UnservableReason_UNSERVABLE_REASON_NOT_TRADABLE
	case otc:
		return false, commonv1.UnservableReason_UNSERVABLE_REASON_OTC
	}
	return true, commonv1.UnservableReason_UNSERVABLE_REASON_UNSPECIFIED
}

func (a *assetSet) servable(sym string) bool {
	ok, _ := a.classify(sym)
	return ok
}

// liveFetchAllowed is the single live-fetch decision for a symbol; a nil snapshot fails open.
func liveFetchAllowed(snap *assetSet, sym string) bool {
	if snap == nil {
		return true
	}
	return snap.servable(sym)
}

// assetServabilityState: unloadedWarned is touched only by the refresher goroutine.
type assetServabilityState struct {
	snap           atomic.Pointer[assetSet]
	unloadedWarned bool
}

// markWarmIfServable warms symbols unless the loaded snapshot marks them unservable, and returns that snapshot.
// gate applies at warm-add sites only; warm-set readers are never filtered
func (s *MarketDataService) markWarmIfServable(symbols ...string) *assetSet {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	snap := s.assets.snap.Load()
	for _, sym := range symbols {
		if sym == "" || (snap != nil && !snap.servable(sym)) {
			continue
		}
		s.warmSymbols[sym] = struct{}{}
	}
	return snap
}

// GetSymbolServability classifies symbols against the in-memory asset set only (no DB, no Alpaca call).
func (s *MarketDataService) GetSymbolServability(_ context.Context, req *marketdatav1.GetSymbolServabilityRequest) (*marketdatav1.GetSymbolServabilityResponse, error) {
	if n := len(req.GetSymbols()); n > servabilityMaxSymbols {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("at most %d symbols per request, got %d", servabilityMaxSymbols, n))
	}
	symbols := normalizeSymbols(req.GetSymbols())
	snap := s.assets.snap.Load()
	resp := &marketdatav1.GetSymbolServabilityResponse{
		Symbols:        make([]*marketdatav1.SymbolServability, 0, len(symbols)),
		AssetSetLoaded: snap != nil,
	}
	for _, sym := range symbols {
		servable, reason := snap.classify(sym)
		resp.Symbols = append(resp.Symbols, &marketdatav1.SymbolServability{Symbol: sym, Servable: servable, Reason: reason})
	}
	return resp, nil
}

// refreshAssets replaces the snapshot unless the new list is empty or below the shrink guard.
func (s *MarketDataService) refreshAssets(ctx context.Context) error {
	src, err := s.registry.Get("")
	if err != nil {
		return err
	}
	prev := s.assets.snap.Load()
	assets, err := src.ListAssets(ctx, assetClassUSEquity)
	if err != nil {
		if prev != nil {
			slog.WarnContext(ctx, "asset set refresh failed; keeping last good set", "error", err)
		}
		return fmt.Errorf("list assets: %w", err)
	}
	next := newAssetSet(assets)
	if len(next.otc) == 0 || (prev != nil && len(next.otc)*100 < len(prev.otc)*assetShrinkKeepPercent) {
		prevCount := 0
		if prev != nil {
			prevCount = len(prev.otc)
			slog.WarnContext(ctx, "asset set refresh rejected; keeping last good set", "old_count", prevCount, "new_count", len(next.otc))
		}
		return fmt.Errorf("asset set refresh rejected: %d assets (previous %d)", len(next.otc), prevCount)
	}
	s.assets.snap.Store(next)
	if prev != nil {
		return nil
	}
	pruned := 0
	s.warmMu.Lock()
	for sym := range s.warmSymbols {
		if !next.servable(sym) {
			delete(s.warmSymbols, sym)
			pruned++
		}
	}
	s.warmMu.Unlock()
	slog.InfoContext(ctx, "asset set loaded", "count", len(next.otc), "pruned", pruned)
	return nil
}

// noteAssetRefreshFailure logs one WARN on entering the unloaded state, not one per failed attempt.
func (s *MarketDataService) noteAssetRefreshFailure(ctx context.Context, err error) {
	if s.assets.snap.Load() != nil || s.assets.unloadedWarned {
		return
	}
	s.assets.unloadedWarned = true
	slog.WarnContext(ctx, "asset set unavailable; treating every symbol as servable", "error", err)
}

func nextAssetRetryDelay(cur time.Duration) time.Duration {
	if cur <= 0 {
		return assetRetryInitial
	}
	return min(cur*2, assetRetryMax)
}

// resolveAssetRefreshInterval returns 0 for a paused (<= 0) value and clamps above 24h.
func resolveAssetRefreshInterval(cfg intGetter) time.Duration {
	if cfg == nil {
		return defaultAssetRefreshHours * time.Hour
	}
	v := cfg.GetInt(assetRefreshHoursKey, defaultAssetRefreshHours)
	switch {
	case v <= 0:
		return 0
	case v > maxAssetRefreshHours:
		return maxAssetRefreshHours * time.Hour
	}
	return time.Duration(v) * time.Hour
}

// StartAssetSetRefresher loads the asset set at boot, then re-checks the live interval every minute.
// Runs on the long-lived main ctx: background work carries no propagation headers by design.
func (s *MarketDataService) StartAssetSetRefresher(ctx context.Context) {
	var lastSuccess, retryAt time.Time
	var delay time.Duration
	attempt := func() {
		if err := s.refreshAssets(ctx); err != nil {
			s.noteAssetRefreshFailure(ctx, err)
			delay = nextAssetRetryDelay(delay)
			retryAt = time.Now().Add(delay)
			return
		}
		lastSuccess, delay = time.Now(), 0
	}
	attempt()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			interval := resolveAssetRefreshInterval(s.budgetCfg)
			if interval == 0 {
				continue // paused via config; keep the current set
			}
			now := time.Now()
			if delay > 0 && now.Before(retryAt) {
				continue
			}
			if delay == 0 && now.Sub(lastSuccess) < interval {
				continue
			}
			attempt()
		}
	}
}
