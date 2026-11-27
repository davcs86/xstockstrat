package service

import (
	"context"
	"log/slog"
	"time"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

const (
	barsMissBackoffKey             = "bars.miss_backoff_ms"
	defaultBarsMissBackoffMs int64 = 1800000
)

// resolveBarsMissBackoff reads the GetBars miss window live; unlike resolvePositiveInt, <= 0 means
// disabled (every miss fetches and warns), not default.
func resolveBarsMissBackoff(cfg intGetter) time.Duration {
	v := defaultBarsMissBackoffMs
	if cfg != nil {
		v = cfg.GetInt(barsMissBackoffKey, defaultBarsMissBackoffMs)
	}
	if v <= 0 {
		return 0
	}
	return time.Duration(v) * time.Millisecond
}

// barsFetch is one fetchAndCacheBars outcome; confirmedEmpty is set only for an empty fetch on a live ctx.
type barsFetch struct {
	bars           []*marketdatav1.Bar
	token          string
	confirmedEmpty bool
}

// missFetchDue never writes an entry, so concurrent cold calls may each fetch once (accepted herd).
func (s *MarketDataService) missFetchDue(key string, window time.Duration, now time.Time) bool {
	s.missMu.Lock()
	defer s.missMu.Unlock()
	if window <= 0 {
		clear(s.lastEmptyFetch)
		return true
	}
	last, ok := s.lastEmptyFetch[key]
	return !ok || now.Sub(last) >= window
}

// noteMissResult is the only writer of lastEmptyFetch: an entry is set only on a confirmed empty.
func (s *MarketDataService) noteMissResult(key string, window time.Duration, now time.Time, f barsFetch) (firstEmpty bool) {
	s.missMu.Lock()
	defer s.missMu.Unlock()
	_, had := s.lastEmptyFetch[key]
	for k, last := range s.lastEmptyFetch {
		if now.Sub(last) >= window {
			delete(s.lastEmptyFetch, k)
		}
	}
	switch {
	case len(f.bars) > 0:
		delete(s.lastEmptyFetch, key)
	case f.confirmedEmpty:
		if s.lastEmptyFetch == nil {
			s.lastEmptyFetch = make(map[string]time.Time)
		}
		s.lastEmptyFetch[key] = now
	}
	return !had
}

// liveRefetch keeps the stored page when the refetch yields nothing. Only an implicit first-page miss
// consults the window; a stored (stale) page never takes the miss lock.
func (s *MarketDataService) liveRefetch(ctx context.Context, symbol, tf string, start, readStart, end time.Time, pageSize int, implicitFirstPage bool, stored []*marketdatav1.Bar, storedToken string, now time.Time) ([]*marketdatav1.Bar, string) {
	miss := len(stored) == 0
	cached := miss && implicitFirstPage
	key := symbol + "|" + tf
	var window time.Duration
	if cached {
		window = resolveBarsMissBackoff(s.budgetCfg)
		if !s.missFetchDue(key, window, now) {
			return stored, storedToken
		}
	}
	f := s.fetchAndCacheBars(ctx, symbol, tf, readStart, end, pageSize, implicitFirstPage)
	firstEmpty := true
	if cached && window > 0 {
		firstEmpty = s.noteMissResult(key, window, now, f)
	}
	if len(f.bars) > 0 {
		return f.bars, f.token
	}
	if miss {
		if firstEmpty {
			warnUnlessDone(ctx, "GetBars: no bars stored and live fetch returned none",
				"symbol", symbol, "timeframe", tf, "start", start, "end", end)
		} else {
			slog.DebugContext(ctx, "GetBars: no bars stored and live fetch returned none",
				"symbol", symbol, "timeframe", tf, "start", start, "end", end)
		}
	}
	return stored, storedToken
}
