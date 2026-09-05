package service

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/sync/singleflight"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	"github.com/xstockstrat/marketdata/internal/config"
	"github.com/xstockstrat/marketdata/internal/middleware"
	"github.com/xstockstrat/marketdata/internal/repository"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/timeframe"
)

// MarketDataService implements business logic for the marketdata service.
type MarketDataService struct {
	registry *source.Registry
	repo     *repository.MarketDataRepo
	cfg      *config.Watcher
	ledger   ledgerv1.LedgerServiceClient
	notify   notifyv1.NotifyServiceClient

	// subscribers maps subscriber ID → channel for streaming bars
	mu        sync.RWMutex
	barSubs   map[string]chan *marketdatav1.Bar
	quoteSubs map[string]chan *marketdatav1.Quote

	// warmSymbols is the demand-driven set GetLatestQuote/GetBars mark; the warm poller and bar
	// ingester keep their data fresh so later reads hit the cache, not a live Alpaca call.
	warmMu      sync.Mutex
	warmSymbols map[string]struct{}

	// lastStaleCheck rate-limits the stale-bar refetch to one live fetch per (symbol|timeframe)
	// per interval, so a weekend (newest bar legitimately old) doesn't refetch on every poll.
	staleMu        sync.Mutex
	lastStaleCheck map[string]time.Time

	// quoteSingleflight coalesces concurrent batch-quote cold fetches keyed on the sorted cold set,
	// so N overlapping GetLatestQuotes calls for the same misses trigger one upstream Alpaca fetch
	// (feature 178, @AC-3). Distinct code path from staleMu — no shared lock, no deadlock.
	quoteSingleflight singleflight.Group

	// fundamentals is the active fundamentals source, held separately from the OHLCV registry
	// (FR-2). Always non-nil (feature 082); marketdata.<fundProvider>.enabled gates use, not construction.
	fundamentals source.FundamentalsSource
	// fundProvider names the active fundamentals provider ("fmp" or "finnhub"),
	// frozen once at construction (never re-read live) — see NewMarketDataService.
	fundProvider string
	// fundCfg / fundRepo are the config + repo surfaces the fundamentals RPCs use,
	// behind interfaces so the cache/quota/gate logic is unit-testable with stubs.
	fundCfg  fundamentalsConfig
	fundRepo fundamentalsRepo
	// quotaAlert dedupes the 80%-quota WARNING to one emit per active window (UTC day for FMP,
	// rolling window for Finnhub — see maybeAlertQuota/fundamentalsQuota).
	quotaAlertMu     sync.Mutex
	quotaAlertBucket string
}

// fundamentalsConfig is the slice of *config.Watcher the fundamentals RPCs read.
type fundamentalsConfig interface {
	GetBool(key string, defaultVal bool) bool
	GetInt(key string, defaultVal int64) int64
	GetString(key, defaultVal string) string
}

// fundamentalsRepo is the persistence surface for the fundamentals cache/quota.
type fundamentalsRepo interface {
	GetFundamentals(ctx context.Context, symbol string) (*source.Fundamentals, time.Time, bool, error)
	UpsertFundamentals(ctx context.Context, f *source.Fundamentals) error
	CountFundamentalsFetchedToday(ctx context.Context) (int, error)
	CountFundamentalsFetchedSince(ctx context.Context, since time.Time) (int, error)
}

// NewMarketDataService creates the service and dials ledger + notify. fundamentals is the
// active source (always non-nil); provider names it and is frozen here, never re-read live.
func NewMarketDataService(
	registry *source.Registry,
	repo *repository.MarketDataRepo,
	cfgWatcher *config.Watcher,
	ledgerEndpoint string,
	notifyEndpoint string,
	fundamentals source.FundamentalsSource,
	provider string,
) (*MarketDataService, error) {
	ledgerConn, err := grpc.NewClient(ledgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	notifyConn, err := grpc.NewClient(notifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial notify: %w", err)
	}
	return &MarketDataService{
		registry:       registry,
		repo:           repo,
		cfg:            cfgWatcher,
		ledger:         ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:         notifyv1.NewNotifyServiceClient(notifyConn),
		barSubs:        make(map[string]chan *marketdatav1.Bar),
		quoteSubs:      make(map[string]chan *marketdatav1.Quote),
		warmSymbols:    make(map[string]struct{}),
		lastStaleCheck: make(map[string]time.Time),
		fundamentals:   fundamentals,
		fundProvider:   provider,
		fundCfg:        cfgWatcher,
		fundRepo:       repo,
	}, nil
}

// GetBars retrieves historical OHLCV bars, querying from TimescaleDB.
func (s *MarketDataService) GetBars(ctx context.Context, req *marketdatav1.GetBarsRequest) (*marketdatav1.GetBarsResponse, error) {
	// Normalize the requested interval to the canonical DB spelling (ingester/backfill store
	// canonical); without it QueryBars never matches. Prefer the enum, fall back to the string.
	legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	canonicalTf := legacyTf
	if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil {
		canonicalTf = c
	}

	// Only "1d" is servable — reject before markWarm/DB/live so a rejected request never warms a
	// symbol or spends an Alpaca call. Coverage/Delete stay permissive (see their docs).
	if canonicalTf != "1d" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("timeframe %q not supported; only \"1d\" is servable", canonicalTf))
	}

	// A charted symbol becomes "warm" so the always-on bar ingester keeps it fresh.
	s.markWarm(req.Symbol)

	pageSize := 500
	pageToken := ""
	if req.Page != nil {
		if req.Page.PageSize > 0 {
			pageSize = int(req.Page.PageSize)
		}
		pageToken = req.Page.PageToken
	}

	var start, end time.Time
	if req.Range != nil {
		if req.Range.Start != nil {
			start = req.Range.Start.AsTime()
		}
		if req.Range.End != nil {
			end = req.Range.End.AsTime()
		}
	}
	// No explicit range START = "latest bars" read (charts/screener) → newest page; WITH a start =
	// paginated backtest → oldest-page-forward. startImplicit also gates the staleness refetch below.
	startImplicit := req.Range == nil || req.Range.Start == nil
	if end.IsZero() {
		end = time.Now()
	}
	if start.IsZero() {
		// Size the implicit window to the requested page for this timeframe (not a flat 24h, which
		// yields ~0 bars for a daily chart on a weekend); 3× slack absorbs market-closed gaps.
		start = end.Add(-defaultBarLookback(canonicalTf, pageSize))
	}

	var (
		bars      []*marketdatav1.Bar
		nextToken string
		err       error
	)
	if startImplicit && pageToken == "" {
		// Newest page (ascending): charts/screener fetch only page one, so QueryBars' oldest-page-forward
		// read would render months-old bars for any symbol with more than pageSize stored.
		bars, err = s.repo.QueryRecentBars(ctx, req.Symbol, canonicalTf, end, pageSize)
	} else {
		bars, nextToken, err = s.repo.QueryBars(ctx, req.Symbol, canonicalTf, start, end, pageSize, pageToken)
	}
	if err != nil {
		return nil, fmt.Errorf("query bars: %w", err)
	}

	// Live-fetch fallback (first page only), via fetchAndCacheBars: (1) DB miss — no stored bars;
	// (2) staleness — implicit-window read whose newest bar is older than one interval (rate-limited).
	if pageToken == "" {
		refetch := len(bars) == 0
		if !refetch && startImplicit && len(bars) > 0 {
			if interval := timeframe.Interval(canonicalTf); interval > 0 {
				newest := bars[len(bars)-1].GetTime().AsTime()
				if time.Since(newest) > interval && s.staleCheckDue(req.Symbol, canonicalTf, interval, time.Now()) {
					refetch = true
				}
			}
		}
		if refetch {
			// Keep stale-but-present bars if the refetch yields nothing (e.g. a weekend) rather
			// than blanking a chart that has data.
			if fresh, freshToken := s.fetchAndCacheBars(ctx, req.Symbol, canonicalTf, start, end, pageSize, startImplicit); len(fresh) > 0 {
				bars, nextToken = fresh, freshToken
			}
		}
	}

	return &marketdatav1.GetBarsResponse{
		Bars: bars,
		Page: &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
}

// staleCheckDue reports whether a stale-bar refetch may run now for this (symbol,timeframe) and
// atomically marks it done — so at most one live Alpaca fetch runs per interval.
func (s *MarketDataService) staleCheckDue(symbol, tf string, interval time.Duration, now time.Time) bool {
	key := symbol + "|" + tf
	s.staleMu.Lock()
	defer s.staleMu.Unlock()
	if last, ok := s.lastStaleCheck[key]; ok && now.Sub(last) < interval {
		return false
	}
	s.lastStaleCheck[key] = now
	return true
}

// fetchAndCacheBars fetches from the live source, persists, and re-reads a page: newest page when
// recent, else oldest-page-forward. On any failure it logs and returns no bars (GetBars → empty response).
func (s *MarketDataService) fetchAndCacheBars(ctx context.Context, symbol, tf string, start, end time.Time, pageSize int, recent bool) ([]*marketdatav1.Bar, string) {
	src, err := s.registry.Get("")
	if err != nil {
		slog.Warn("GetBars: resolve source failed", "symbol", symbol, "error", err)
		return nil, ""
	}
	live, err := src.GetBars(ctx, symbol, tf, start, end)
	if err != nil {
		slog.Warn("GetBars: live fetch failed", "symbol", symbol, "timeframe", tf, "error", err)
		return nil, ""
	}
	if len(live) == 0 {
		return nil, ""
	}
	if err := s.repo.InsertBars(ctx, live); err != nil {
		slog.Warn("GetBars: cache insert failed", "symbol", symbol, "error", err)
		return truncateBars(live, pageSize, recent), ""
	}
	if recent {
		bars, err := s.repo.QueryRecentBars(ctx, symbol, tf, end, pageSize)
		if err != nil {
			slog.Warn("GetBars: re-read after cache failed", "symbol", symbol, "error", err)
			return truncateBars(live, pageSize, recent), ""
		}
		return bars, ""
	}
	bars, nextToken, err := s.repo.QueryBars(ctx, symbol, tf, start, end, pageSize, "")
	if err != nil {
		slog.Warn("GetBars: re-read after cache failed", "symbol", symbol, "error", err)
		return truncateBars(live, pageSize, recent), ""
	}
	return bars, nextToken
}

// truncateBars returns at most pageSize bars from a freshly-fetched (ascending) live slice — the
// NEWEST page when recent, else the first page — used only on the cache-write-failure fallback.
func truncateBars(live []*marketdatav1.Bar, pageSize int, recent bool) []*marketdatav1.Bar {
	if len(live) <= pageSize {
		return live
	}
	if recent {
		return live[len(live)-pageSize:]
	}
	return live[:pageSize]
}

// defaultBarLookback sizes the implicit window to cover at least `bars` bars of the timeframe,
// times a slack multiplier for market-closed gaps. Unknown timeframes fall back to a day.
func defaultBarLookback(canonicalTf string, bars int) time.Duration {
	interval := timeframe.Interval(canonicalTf)
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if bars <= 0 {
		bars = 100
	}
	const slack = 3
	return time.Duration(bars) * interval * slack
}

// GetDataCoverage reports stored OHLCV coverage for a symbol+timeframe. Deliberately permissive
// on 15m/1h (unlike GetBars) so historical rows stay inspectable — do not "fix" this asymmetry.
func (s *MarketDataService) GetDataCoverage(ctx context.Context, req *marketdatav1.GetDataCoverageRequest) (*marketdatav1.GetDataCoverageResponse, error) {
	if req.Symbol == "" {
		return nil, fmt.Errorf("symbol required")
	}
	canonical, err := timeframe.Resolve(req.GetTimeframe(), "")
	if err != nil {
		return nil, fmt.Errorf("resolve timeframe: %w", err)
	}

	var start, end time.Time
	if req.Range != nil {
		if req.Range.Start != nil {
			start = req.Range.Start.AsTime()
		}
		if req.Range.End != nil {
			end = req.Range.End.AsTime()
		}
	}
	if end.IsZero() {
		end = time.Now()
	}
	if start.IsZero() {
		// "full history" floor when no range is supplied.
		start = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	}

	earliest, latest, count, err := s.repo.GetCoverage(ctx, req.Symbol, canonical, start, end)
	if err != nil {
		return nil, fmt.Errorf("get coverage: %w", err)
	}

	resp := &marketdatav1.GetDataCoverageResponse{
		Symbol:    req.Symbol,
		Timeframe: req.GetTimeframe(),
		BarsTotal: count,
	}
	if count > 0 {
		resp.Earliest = timestamppb.New(earliest)
		resp.Latest = timestamppb.New(latest)
		resp.CoveredRanges = []*marketdatav1.CoverageRange{{
			Start:    timestamppb.New(earliest),
			End:      timestamppb.New(latest),
			BarCount: count,
		}}
	}
	for _, g := range timeframe.ComputeGaps(start, end, earliest, latest, count) {
		resp.Gaps = append(resp.Gaps, &commonv1.TimeRange{
			Start: timestamppb.New(g.Start),
			End:   timestamppb.New(g.End),
		})
	}
	return resp, nil
}

// resolveDeletePlan validates a delete and computes the scoped (timeframe,start,end). Pure/testable;
// enforces symbol-required + admin-only (scope&0x04) + optional window cap. Permissive on 15m/1h — don't "fix".
func resolveDeletePlan(symbol, accessScope string, tf commonv1.Timeframe, rng *commonv1.TimeRange, maxDays int64) (canonical string, start, end time.Time, err error) {
	if symbol == "" {
		return "", time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("symbol required; refusing unbounded delete"))
	}
	// Admin gate (0x04): destructive op, admin/operator only (FR-7).
	scope, _ := strconv.Atoi(accessScope)
	if scope&0x04 == 0 {
		return "", time.Time{}, time.Time{}, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("admin scope required"))
	}
	// Resolve timeframe: UNSPECIFIED → "" = delete across all timeframes for the symbol/range.
	if tf != commonv1.Timeframe_TIMEFRAME_UNSPECIFIED {
		canonical, err = timeframe.Resolve(tf, "")
		if err != nil {
			return "", time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("resolve timeframe: %w", err))
		}
	}
	if rng != nil {
		if rng.Start != nil {
			start = rng.Start.AsTime()
		}
		if rng.End != nil {
			end = rng.End.AsTime()
		}
	}
	// Delete-window guard: when maxDays > 0 and a bounded range exceeds it, reject. A whole-symbol
	// delete (no range) is exempt.
	if maxDays > 0 && !start.IsZero() && !end.IsZero() && end.Sub(start) > time.Duration(maxDays)*24*time.Hour {
		return "", time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("delete range %d days exceeds marketdata.backfill.max_delete_days=%d",
				int(end.Sub(start).Hours()/24), maxDays))
	}
	return canonical, start, end, nil
}

// DeleteBackfilledData performs a scoped, admin-only delete of backfilled OHLCV bars (FR-5).
// Symbol required (guards against unbounded delete); range/timeframe optional. Emits an audit event.
func (s *MarketDataService) DeleteBackfilledData(ctx context.Context, req *marketdatav1.DeleteBackfilledDataRequest) (*marketdatav1.DeleteBackfilledDataResponse, error) {
	canonical, start, end, err := resolveDeletePlan(
		req.Symbol,
		middleware.FromContext(ctx).AccessScope,
		req.Timeframe,
		req.Range,
		s.cfg.GetInt("marketdata.backfill.max_delete_days", 0),
	)
	if err != nil {
		return nil, err
	}

	n, err := s.repo.DeleteBars(ctx, req.Symbol, canonical, start, end)
	if err != nil {
		return nil, fmt.Errorf("delete bars: %w", err)
	}
	s.emitEvent(ctx, "marketdata.backfill.data_deleted", "backfill:delete:"+req.Symbol, map[string]interface{}{
		"symbol":       req.Symbol,
		"timeframe":    canonical,
		"rows_deleted": n,
	})
	return &marketdatav1.DeleteBackfilledDataResponse{RowsDeleted: n}, nil
}

// GetLatestQuote returns the most recent quote for a symbol from the DB.
func (s *MarketDataService) GetLatestQuote(ctx context.Context, symbol string) (*marketdatav1.Quote, error) {
	// Track the symbol so the warm poller keeps its quote fresh in the DB.
	s.markWarm(symbol)

	q, err := s.repo.GetLatestQuote(ctx, symbol)
	if err == nil {
		return q, nil
	}
	// DB miss — fall back to the live source and cache the result so the next
	// read (and the warm poller) can serve it from the DB.
	src, srcErr := s.registry.Get("")
	if srcErr != nil {
		return nil, srcErr
	}
	live, liveErr := src.GetLatestQuote(ctx, symbol)
	if liveErr != nil {
		return nil, liveErr
	}
	if err := s.repo.InsertQuote(ctx, live); err != nil {
		slog.Warn("GetLatestQuote: cache insert failed", "symbol", symbol, "error", err)
	}
	return live, nil
}

// GetLatestQuotes returns the latest quote for each requested symbol, cache-first and batched
// (feature 178). Warm (cached) symbols are read in one DISTINCT ON query; the cold remainder is
// fetched from the live source in one multi-symbol call, coalesced under singleflight on the sorted
// cold set so concurrent callers share a single upstream fetch (@AC-3), then cached. A symbol with
// no quote from either path is omitted from the result (null-not-zero), never a zero-price Quote.
func (s *MarketDataService) GetLatestQuotes(ctx context.Context, symbols []string) ([]*marketdatav1.Quote, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	for _, sym := range symbols {
		s.markWarm(sym)
	}
	// Warm (cached) hits in one query. s.repo is nil only on the no-DB unit-test path (feature 178
	// @AC-3 single-flight coverage) — there every symbol is treated as cold.
	warm := map[string]*marketdatav1.Quote{}
	if s.repo != nil {
		var err error
		warm, err = s.repo.GetLatestQuotesBatch(ctx, symbols)
		if err != nil {
			return nil, err
		}
	}
	var cold []string
	for _, sym := range symbols {
		if _, ok := warm[sym]; !ok {
			cold = append(cold, sym)
		}
	}
	if len(cold) > 0 {
		sortedCold := append([]string(nil), cold...)
		sort.Strings(sortedCold)
		key := strings.Join(sortedCold, ",")
		v, fetchErr, _ := s.quoteSingleflight.Do(key, func() (interface{}, error) {
			src, e := s.registry.Get("")
			if e != nil {
				return nil, e
			}
			ms, ok := src.(source.MultiSymbolSource)
			if !ok {
				return map[string]*marketdatav1.Quote{}, nil
			}
			coldMap, e := ms.GetLatestQuotesMulti(ctx, sortedCold)
			if e != nil {
				return nil, e
			}
			// Cache each cold quote independently (ON CONFLICT upsert, not one wrapping txn) —
			// matches the singular path (:424) and the warm poller (:520). s.repo is nil only on
			// the no-DB unit-test path.
			if s.repo != nil {
				for _, q := range coldMap {
					if q == nil {
						continue
					}
					if insErr := s.repo.InsertQuote(ctx, q); insErr != nil {
						slog.Warn("GetLatestQuotes: cache insert failed", "symbol", q.Symbol, "error", insErr)
					}
				}
			}
			return coldMap, nil
		})
		if fetchErr != nil {
			// WAIVED partial-upstream-failure divergence (design § Open Risks): a cold-batch
			// transport error drops the whole cold set rather than per-symbol; return the error
			// instead of substituting zero values.
			return nil, fetchErr
		}
		if coldMap, ok := v.(map[string]*marketdatav1.Quote); ok {
			for _, q := range coldMap {
				if q != nil {
					warm[q.Symbol] = q
				}
			}
		}
	}
	out := make([]*marketdatav1.Quote, 0, len(warm))
	for _, q := range warm {
		out = append(out, q)
	}
	return out, nil
}

// GetLatestPrice returns the latest trade price + prior-session daily close. Either value is left
// UNSET (never 0) when unavailable so callers can tell "no data" from a real zero (AC-11).
func (s *MarketDataService) GetLatestPrice(ctx context.Context, symbol string) (*marketdatav1.LatestPrice, error) {
	// Track the symbol so the warm poller / bar ingester keep its data fresh.
	s.markWarm(symbol)

	out := &marketdatav1.LatestPrice{Symbol: symbol, Source: "alpaca"}

	if src, err := s.registry.Get(""); err == nil {
		if lt, ok := src.(source.LatestTradeSource); ok {
			if price, ts, tErr := lt.GetLatestTrade(ctx, symbol); tErr == nil {
				out.LastPrice = &price
				out.LastTradeTime = timestamppb.New(ts)
			} else {
				slog.Warn("GetLatestPrice: latest-trade fetch failed", "symbol", symbol, "error", tErr)
			}
		}
	}

	if prev, ok, err := s.repo.GetPreviousDailyClose(ctx, symbol); err != nil {
		slog.Warn("GetLatestPrice: prev daily close read failed", "symbol", symbol, "error", err)
	} else if ok {
		out.PrevClose = &prev
	}

	return out, nil
}

// markWarm adds a symbol to the warm set polled by StartWarmQuotePoller.
func (s *MarketDataService) markWarm(symbol string) {
	if symbol == "" {
		return
	}
	s.warmMu.Lock()
	s.warmSymbols[symbol] = struct{}{}
	s.warmMu.Unlock()
}

// warmSnapshot returns the warm-symbol set (marked by GetBars/GetLatestQuote) that the bar
// ingester consumes — the autonomous-freshness contract: querying a symbol keeps its bars fresh.
func (s *MarketDataService) warmSnapshot() []string {
	s.warmMu.Lock()
	defer s.warmMu.Unlock()
	symbols := make([]string, 0, len(s.warmSymbols))
	for sym := range s.warmSymbols {
		symbols = append(symbols, sym)
	}
	return symbols
}

// StartWarmQuotePoller periodically refreshes every queried symbol's latest quote into the DB
// so reads serve from cache. Interval via marketdata.stream.warm_interval_ms (default 30s; 0 pauses).
func (s *MarketDataService) StartWarmQuotePoller(ctx context.Context) {
	const defaultIntervalMs = 30000
	interval := time.Duration(s.cfg.GetInt("marketdata.stream.warm_interval_ms", defaultIntervalMs)) * time.Millisecond
	if interval <= 0 {
		interval = defaultIntervalMs * time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ms := s.cfg.GetInt("marketdata.stream.warm_interval_ms", defaultIntervalMs)
			if ms <= 0 {
				continue // paused via config
			}
			if newInterval := time.Duration(ms) * time.Millisecond; newInterval != interval {
				interval = newInterval
				ticker.Reset(interval)
			}
			s.warmMu.Lock()
			symbols := make([]string, 0, len(s.warmSymbols))
			for sym := range s.warmSymbols {
				symbols = append(symbols, sym)
			}
			s.warmMu.Unlock()
			if len(symbols) == 0 {
				continue
			}
			src, err := s.registry.Get("")
			if err != nil {
				continue
			}
			// Prefer one multi-symbol request per cycle; fall back to per-symbol.
			if ms, ok := src.(source.MultiSymbolSource); ok {
				if quotes, err := ms.GetLatestQuotesMulti(ctx, symbols); err == nil {
					for _, q := range quotes {
						if err := s.repo.InsertQuote(ctx, q); err != nil {
							slog.Warn("warm poller: cache insert failed", "symbol", q.Symbol, "error", err)
						}
					}
					continue
				} else {
					slog.Warn("warm poller: multi-quote fetch failed, falling back to per-symbol", "error", err)
				}
			}
			var fetched, failed int
			var firstErr error
			for _, sym := range symbols {
				q, err := src.GetLatestQuote(ctx, sym)
				if err != nil {
					failed++
					if firstErr == nil {
						firstErr = err
					}
					continue
				}
				fetched++
				if err := s.repo.InsertQuote(ctx, q); err != nil {
					slog.Warn("warm poller: cache insert failed", "symbol", sym, "error", err)
				}
			}
			// Surface per-symbol fetch failures once per cycle (a high failed count with fetched==0
			// is the signature of a credential/feed problem) instead of dropping them silently.
			if failed > 0 {
				slog.Warn("warm poller: per-symbol quote fetch failures",
					"failed", failed, "fetched", fetched, "total", len(symbols), "sample_error", firstErr)
			}
		}
	}
}

// StartBarIngestPoller continuously ingests recent bars for every warm symbol into marketdata.ohlcv —
// an always-on feed. Interval via marketdata.stream.bar_ingest_interval_ms (default 5m; 0 pauses).
func (s *MarketDataService) StartBarIngestPoller(ctx context.Context) {
	const defaultIntervalMs = 300000
	interval := time.Duration(s.cfg.GetInt("marketdata.stream.bar_ingest_interval_ms", defaultIntervalMs)) * time.Millisecond
	if interval <= 0 {
		interval = defaultIntervalMs * time.Millisecond
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ms := s.cfg.GetInt("marketdata.stream.bar_ingest_interval_ms", defaultIntervalMs)
			if ms <= 0 {
				continue // paused via config
			}
			if newInterval := time.Duration(ms) * time.Millisecond; newInterval != interval {
				interval = newInterval
				ticker.Reset(interval)
			}
			s.ingestRecentBars(ctx)
		}
	}
}

// defaultBarIngestTimeframe defaults marketdata.stream.bar_ingest_timeframe to "1d" — the only
// requestable interval (feature 143). Stays a comma-separated LIST, parsed by resolveIngestTimeframes.
const defaultBarIngestTimeframe = "1d"

// resolveIngestTimeframes parses+canonicalizes the ingest-timeframe list. Fetched bars are
// PERSISTED, so an out-of-vocab entry is skipped with a WARN (MARKETDATA-1); pause via interval<=0.
func resolveIngestTimeframes(raw string) []string {
	if raw == "" {
		raw = defaultBarIngestTimeframe
	}
	seen := map[string]bool{}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		c, err := timeframe.Resolve(commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, part)
		if err != nil {
			slog.Warn("bar ingest: unresolvable entry in bar_ingest_timeframe, skipping",
				"configured", part)
			continue
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		slog.Warn("bar ingest: no resolvable timeframe in bar_ingest_timeframe, using default",
			"configured", raw, "default", defaultBarIngestTimeframe)
		return resolveIngestTimeframes(defaultBarIngestTimeframe)
	}
	return out
}

// minIngestLookback floors a timeframe's lookback at 2× its interval: the configured
// bar_ingest_lookback_ms is sized for 15m and too short to ever re-cover a 1d bar.
func minIngestLookback(canonicalTf string) time.Duration {
	interval := timeframe.Interval(canonicalTf)
	if interval <= 0 {
		return 0
	}
	return 2 * interval
}

// ingestRecentBars upserts the recent bar window for every warm symbol × configured timeframe.
// Overlap is harmless (InsertBars upserts); each window is at least minIngestLookback(tf).
func (s *MarketDataService) ingestRecentBars(ctx context.Context) {
	symbols := s.warmSnapshot()
	if len(symbols) == 0 {
		return
	}
	src, err := s.registry.Get("")
	if err != nil {
		return
	}
	tfs := resolveIngestTimeframes(s.cfg.GetString("marketdata.stream.bar_ingest_timeframe", defaultBarIngestTimeframe))
	lookbackMs := s.cfg.GetInt("marketdata.stream.bar_ingest_lookback_ms", 900000)
	if lookbackMs <= 0 {
		lookbackMs = 900000
	}
	configuredLookback := time.Duration(lookbackMs) * time.Millisecond
	end := time.Now().UTC()
	for _, tf := range tfs {
		lookback := configuredLookback
		if floor := minIngestLookback(tf); floor > lookback {
			lookback = floor
		}
		s.ingestRecentBarsForTimeframe(ctx, src, symbols, tf, end.Add(-lookback), end)
	}
}

// ingestRecentBarsForTimeframe is ingestRecentBars' per-timeframe body, split out so the
// caller can size each timeframe's window independently (see minIngestLookback).
func (s *MarketDataService) ingestRecentBarsForTimeframe(ctx context.Context, src source.DataSourceClient, symbols []string, tf string, start, end time.Time) {
	// Prefer one multi-symbol request per cycle; fall back to per-symbol.
	if ms, ok := src.(source.MultiSymbolSource); ok {
		if barsBySym, err := ms.GetBarsMulti(ctx, symbols, tf, start, end); err == nil {
			for sym, bars := range barsBySym {
				if len(bars) == 0 {
					continue
				}
				if err := s.repo.InsertBars(ctx, bars); err != nil {
					slog.Warn("bar ingest: insert failed", "symbol", sym, "timeframe", tf, "error", err)
				}
			}
			return
		} else {
			slog.Warn("bar ingest: multi-bar fetch failed, falling back to per-symbol", "timeframe", tf, "error", err)
		}
	}
	for _, sym := range symbols {
		bars, err := src.GetBars(ctx, sym, tf, start, end)
		if err != nil {
			slog.Warn("bar ingest: live fetch failed", "symbol", sym, "timeframe", tf, "error", err)
			continue
		}
		if len(bars) == 0 {
			continue
		}
		if err := s.repo.InsertBars(ctx, bars); err != nil {
			slog.Warn("bar ingest: insert failed", "symbol", sym, "timeframe", tf, "error", err)
		}
	}
}

// ListAssets delegates to the default data source.
func (s *MarketDataService) ListAssets(ctx context.Context, req *marketdatav1.ListAssetsRequest) (*marketdatav1.ListAssetsResponse, error) {
	src, err := s.registry.Get("")
	if err != nil {
		return nil, err
	}
	assets, err := src.ListAssets(ctx, req.AssetClass)
	if err != nil {
		return nil, err
	}
	return &marketdatav1.ListAssetsResponse{Assets: assets}, nil
}

// BackfillBars fetches historical bars from Alpaca and persists them.
// Runs synchronously; callers should invoke in a goroutine for async use.
func (s *MarketDataService) BackfillBars(ctx context.Context, req *marketdatav1.BackfillBarsRequest) (*marketdatav1.BackfillBarsResponse, error) {
	var start, end time.Time
	if req.Range != nil {
		if req.Range.Start != nil {
			start = req.Range.Start.AsTime()
		}
		if req.Range.End != nil {
			end = req.Range.End.AsTime()
		}
	}
	if end.IsZero() {
		end = time.Now()
	}
	if start.IsZero() {
		start = end.Add(-365 * 24 * time.Hour)
	}

	// Batch size and rate limit are applied inside the Alpaca client; pagination is transparent,
	// so no batching is needed here.

	// Resolve once (same raw-fallback shape as GetBars): an enum-only caller would otherwise reach
	// Alpaca with "" and persist rows GetBars could never find again.
	legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	canonicalTf := legacyTf
	if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil {
		canonicalTf = c
	}

	// Reject anything but "1d" (mirrors GetBars). Before emitEvent, so a rejected request emits no
	// started/failed ledger pair.
	if canonicalTf != "1d" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("timeframe %q not supported; only \"1d\" is servable", canonicalTf))
	}

	s.emitEvent(ctx, "marketdata.backfill.started", "marketdata:backfill", map[string]interface{}{
		"symbols":   req.Symbols,
		"timeframe": canonicalTf,
	})

	var totalWritten int64
	var failedSymbols []string

	src, err := s.registry.Get("")
	if err != nil {
		return nil, fmt.Errorf("resolve source: %w", err)
	}

	for _, sym := range req.Symbols {
		bars, err := src.GetBars(ctx, sym, canonicalTf, start, end)
		if err != nil {
			slog.Error("backfill failed", "symbol", sym, "error", err)
			failedSymbols = append(failedSymbols, sym)
			continue
		}
		if len(bars) == 0 {
			continue
		}
		if err := s.repo.InsertBars(ctx, bars); err != nil {
			slog.Error("insert bars failed", "symbol", sym, "error", err)
			failedSymbols = append(failedSymbols, sym)
			continue
		}
		totalWritten += int64(len(bars))
		slog.Info("backfill progress", "symbol", sym, "bars", len(bars))
	}

	if len(failedSymbols) > 0 {
		s.emitEvent(ctx, "marketdata.backfill.failed", "marketdata:backfill", map[string]interface{}{
			"failed_symbols": failedSymbols,
		})
	} else {
		s.emitEvent(ctx, "marketdata.backfill.completed", "marketdata:backfill", map[string]interface{}{
			"bars_written": totalWritten,
		})
	}

	return &marketdatav1.BackfillBarsResponse{
		BarsWritten:   totalWritten,
		FailedSymbols: failedSymbols,
		ExpectedBars:  estimateExpectedBars(req.Symbols, canonicalTf, start, end),
	}, nil
}

// estimateExpectedBars approximates total bars across symbols/range (weekdays × per-day factor ×
// symbols) as a progress denominator for xstockstrat-ingest. No US-holiday calendar (FR-6).
func estimateExpectedBars(symbols []string, timeframe string, start, end time.Time) int64 {
	if len(symbols) == 0 || !end.After(start) {
		return 0
	}

	// Count weekdays in [start, end] (inclusive of both endpoint dates).
	var tradingDays int64
	for d := start.Truncate(24 * time.Hour); !d.After(end); d = d.Add(24 * time.Hour) {
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			tradingDays++
		}
	}

	var perDay int64
	switch timeframe {
	case "1d", "1Day":
		perDay = 1
	case "1h", "1Hour":
		perDay = 7 // ~6.5 RTH hours, rounded up
	case "15m", "15Min":
		perDay = 26 // ~6.5 RTH hours × 4 fifteen-min bars
	default:
		perDay = 1
	}

	return tradingDays * perDay * int64(len(symbols))
}

// SubscribeBars registers a subscriber channel for live bars and returns its ID.
// The caller must call UnsubscribeBars(id) when done.
func (s *MarketDataService) SubscribeBars(id string) chan *marketdatav1.Bar {
	ch := make(chan *marketdatav1.Bar, 64)
	s.mu.Lock()
	s.barSubs[id] = ch
	s.mu.Unlock()
	return ch
}

// UnsubscribeBars removes and closes a bar subscriber channel.
func (s *MarketDataService) UnsubscribeBars(id string) {
	s.mu.Lock()
	if ch, ok := s.barSubs[id]; ok {
		delete(s.barSubs, id)
		close(ch)
	}
	s.mu.Unlock()
}

// SubscribeQuotes registers a subscriber channel for live quotes.
func (s *MarketDataService) SubscribeQuotes(id string) chan *marketdatav1.Quote {
	ch := make(chan *marketdatav1.Quote, 64)
	s.mu.Lock()
	s.quoteSubs[id] = ch
	s.mu.Unlock()
	return ch
}

// UnsubscribeQuotes removes a quote subscriber.
func (s *MarketDataService) UnsubscribeQuotes(id string) {
	s.mu.Lock()
	if ch, ok := s.quoteSubs[id]; ok {
		delete(s.quoteSubs, id)
		close(ch)
	}
	s.mu.Unlock()
}

// StartBarStream begins the bar feed for given symbols/timeframe
// and fans out to all registered subscribers.
func (s *MarketDataService) StartBarStream(ctx context.Context, symbols []string, timeframe string) {
	src, err := s.registry.Get("")
	if err != nil {
		slog.Error("source registry error", "error", err)
		return
	}
	feed, err := src.StreamBars(ctx, symbols, timeframe)
	if err != nil {
		slog.Error("stream bars failed", "error", err)
		s.emitAlert(ctx, "marketdata feed stream error: "+err.Error())
		return
	}
	s.emitEvent(ctx, "marketdata.feed.connected", "marketdata:feed", map[string]interface{}{
		"symbols": symbols, "timeframe": timeframe,
	})
	go func() {
		// Streamed bars are Alpaca's 1-minute bars — forwarded to live subscribers only, never
		// persisted here; continuous ingestion is owned by StartBarIngestPoller.
		for bar := range feed {
			s.mu.RLock()
			for _, ch := range s.barSubs {
				select {
				case ch <- bar:
				default:
				}
			}
			s.mu.RUnlock()
		}
		s.emitEvent(ctx, "marketdata.feed.disconnected", "marketdata:feed", map[string]interface{}{
			"symbols": symbols,
		})
	}()
}

// StartQuoteStream begins the quote feed and fans out to subscribers.
func (s *MarketDataService) StartQuoteStream(ctx context.Context, symbols []string) {
	src, err := s.registry.Get("")
	if err != nil {
		slog.Error("source registry error", "error", err)
		return
	}
	feed, err := src.StreamQuotes(ctx, symbols)
	if err != nil {
		slog.Error("stream quotes failed", "error", err)
		return
	}
	go func() {
		for q := range feed {
			_ = s.repo.InsertQuote(ctx, q)
			s.mu.RLock()
			for _, ch := range s.quoteSubs {
				select {
				case ch <- q:
				default:
				}
			}
			s.mu.RUnlock()
		}
	}()
}

func (s *MarketDataService) emitEvent(ctx context.Context, eventType, streamKey string, payload map[string]interface{}) {
	fields := make(map[string]*structpb.Value, len(payload))
	for k, v := range payload {
		val, _ := structpb.NewValue(v)
		fields[k] = val
	}
	_, err := s.ledger.AppendEvent(ctx, &ledgerv1.AppendEventRequest{
		EventType:     eventType,
		SourceService: "marketdata",
		StreamKey:     streamKey,
		OccurredAt:    timestamppb.Now(),
		Payload:       &structpb.Struct{Fields: fields},
	})
	if err != nil {
		slog.Warn("ledger append failed", "event_type", eventType, "error", err)
	}
}

func (s *MarketDataService) emitAlert(ctx context.Context, msg string) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_ERROR,
		Category:      "system",
		Title:         "marketdata feed error",
		Body:          msg,
		SourceService: "marketdata",
	})
	if err != nil {
		slog.Warn("notify emit failed", "error", err)
	}
}

// ── Fundamentals (feature 059; switchable provider 129) ─────
// Read-through cache → quota guard → fetch → 80% WARNING; the active provider is the single
// fundamentals chokepoint, gated by marketdata.<fundProvider>.enabled.

// GetFundamentals returns cached-or-fetched fundamentals for one symbol.
func (s *MarketDataService) GetFundamentals(ctx context.Context, symbol string) (*marketdatav1.Fundamentals, error) {
	if symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("symbol required"))
	}
	if err := s.fundamentalsEnabled(); err != nil {
		return nil, err
	}
	f, err := s.resolveFundamentals(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// GetFundamentalsMulti returns fundamentals for several symbols, batching the
// needs-fetch set through one provider quote call where the provider supports it (FR-5).
func (s *MarketDataService) GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*marketdatav1.Fundamentals, error) {
	if err := s.fundamentalsEnabled(); err != nil {
		return nil, err
	}
	ttl := time.Duration(s.fundCfg.GetInt("marketdata."+s.fundProvider+".cache_ttl_hours", 24)) * time.Hour

	out := make([]*marketdatav1.Fundamentals, 0, len(symbols))
	var needFetch []string
	cached := map[string]*marketdatav1.Fundamentals{}

	for _, sym := range symbols {
		if sym == "" {
			continue
		}
		f, fetchedAt, found, err := s.fundRepo.GetFundamentals(ctx, sym)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if found && time.Since(fetchedAt) <= ttl {
			cached[strings.ToUpper(sym)] = s.toProtoFundamentals(f, false)
			continue
		}
		needFetch = append(needFetch, sym)
	}

	if len(needFetch) > 0 {
		count, cap, windowSeconds, err := s.fundamentalsQuota(ctx)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if count >= cap {
			// Quota exhausted: serve stale rows where we have them, skip the rest.
			for _, sym := range needFetch {
				if f, _, found, _ := s.fundRepo.GetFundamentals(ctx, sym); found {
					cached[strings.ToUpper(sym)] = s.toProtoFundamentals(f, true)
				}
			}
		} else {
			fetched, err := s.fundamentals.GetFundamentalsMulti(ctx, needFetch)
			if err != nil {
				return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", s.fundProvider, err))
			}
			for _, f := range fetched {
				if upErr := s.fundRepo.UpsertFundamentals(ctx, f); upErr != nil {
					slog.Warn("GetFundamentalsMulti: cache upsert failed", "symbol", f.Symbol, "error", upErr)
				}
				cached[strings.ToUpper(f.Symbol)] = s.toProtoFundamentals(f, false)
			}
			s.maybeAlertQuota(ctx, count+len(fetched), cap, windowSeconds)
		}
	}

	// Preserve requested order; drop symbols neither cached nor fetched.
	for _, sym := range symbols {
		if f, ok := cached[strings.ToUpper(sym)]; ok {
			out = append(out, f)
		}
	}
	return out, nil
}

// resolveFundamentals implements the single-symbol read-through: cache hit within TTL,
// else quota-guarded provider fetch, else stale/ResourceExhausted.
func (s *MarketDataService) resolveFundamentals(ctx context.Context, symbol string) (*marketdatav1.Fundamentals, error) {
	ttl := time.Duration(s.fundCfg.GetInt("marketdata."+s.fundProvider+".cache_ttl_hours", 24)) * time.Hour
	cached, fetchedAt, found, err := s.fundRepo.GetFundamentals(ctx, symbol)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if found && time.Since(fetchedAt) <= ttl {
		return s.toProtoFundamentals(cached, false), nil
	}

	count, cap, windowSeconds, err := s.fundamentalsQuota(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if count >= cap {
		if found {
			return s.toProtoFundamentals(cached, true), nil // stale under quota exhaustion (FR-4)
		}
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("%s request cap %d reached", s.fundProvider, cap))
	}

	fresh, err := s.fundamentals.GetFundamentals(ctx, symbol)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("%s fetch: %w", s.fundProvider, err))
	}
	if upErr := s.fundRepo.UpsertFundamentals(ctx, fresh); upErr != nil {
		slog.Warn("GetFundamentals: cache upsert failed", "symbol", symbol, "error", upErr)
	}
	s.maybeAlertQuota(ctx, count+1, cap, windowSeconds)
	return s.toProtoFundamentals(fresh, false), nil
}

// fundamentalsEnabled returns FailedPrecondition (no external call) when the active provider is
// disabled. The "s.fundamentals == nil" half is defensive-only — always non-nil via boot (feature 082).
func (s *MarketDataService) fundamentalsEnabled() error {
	if !s.fundCfg.GetBool("marketdata."+s.fundProvider+".enabled", false) || s.fundamentals == nil {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s fundamentals source disabled", s.fundProvider))
	}
	return nil
}

// fundamentalsQuota returns the active provider's current count, cap, and window (seconds) for the
// 80%-WARNING/at-cap logic: FMP uses a fixed daily cap, Finnhub a rolling window (feature 129).
func (s *MarketDataService) fundamentalsQuota(ctx context.Context) (count, cap int, windowSeconds int64, err error) {
	switch s.fundProvider {
	case "finnhub":
		windowSeconds = s.fundCfg.GetInt("marketdata.finnhub.rate_window_seconds", 60)
		cap = int(s.fundCfg.GetInt("marketdata.finnhub.symbols_per_minute", 20))
		since := time.Now().Add(-time.Duration(windowSeconds) * time.Second)
		count, err = s.fundRepo.CountFundamentalsFetchedSince(ctx, since)
	default: // "fmp" and any unrecognized value fall back to the existing, well-tested daily-cap shape
		windowSeconds = 86400
		cap = int(s.fundCfg.GetInt("marketdata.fmp.daily_request_cap", 250))
		count, err = s.fundRepo.CountFundamentalsFetchedToday(ctx)
	}
	return count, cap, windowSeconds, err
}

// maybeAlertQuota emits one WARNING per active window once the count crosses 80% of cap. The dedup
// bucket is a window-floor, so a short window (Finnhub) re-fires per window instead of once per UTC day.
func (s *MarketDataService) maybeAlertQuota(ctx context.Context, count, cap int, windowSeconds int64) {
	if cap <= 0 || count < (cap*8)/10 {
		return
	}
	bucket := fmt.Sprintf("%d", time.Now().Unix()/windowSeconds)
	s.quotaAlertMu.Lock()
	if s.quotaAlertBucket == bucket {
		s.quotaAlertMu.Unlock()
		return
	}
	s.quotaAlertBucket = bucket
	s.quotaAlertMu.Unlock()
	s.emitWarning(ctx, fmt.Sprintf("%s request usage at %d/%d (>=80%% of cap) in the last %ds",
		strings.ToUpper(s.fundProvider), count, cap, windowSeconds))
}

// emitWarning emits an ALERT_SEVERITY_WARNING notify alert. Distinct from emitAlert,
// which hardcodes ALERT_SEVERITY_ERROR — FR-7 needs a WARNING.
func (s *MarketDataService) emitWarning(ctx context.Context, msg string) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      "system",
		Title:         fmt.Sprintf("marketdata %s quota warning", strings.ToUpper(s.fundProvider)),
		Body:          msg,
		SourceService: "marketdata",
	})
	if err != nil {
		slog.Warn("notify emit (warning) failed", "error", err)
	}
}

// fundamentalMetricPtr pairs a nullable metric with its wire name (matching marketdata.proto's
// field names verbatim, which match analysis' screener metric_name set).
type fundamentalMetricPtr struct {
	name string
	val  *float64
}

// derefOrZero reads a nullable metric as 0.0 when nil. Presence is signaled by missing_metrics
// (set separately), so callers must not infer "present" from a non-zero reading alone.
func derefOrZero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// toProtoFundamentals maps source.Fundamentals to the wire message. A method (not a free
// function) so its empty-Source fallback names the active provider (feature 129), not "fmp".
func (s *MarketDataService) toProtoFundamentals(f *source.Fundamentals, stale bool) *marketdatav1.Fundamentals {
	if f == nil {
		return nil
	}
	src := f.Source
	if src == "" {
		src = s.fundProvider
	}
	metrics := []fundamentalMetricPtr{
		{"market_cap", f.MarketCap},
		{"pe_ratio", f.PERatio},
		{"pb_ratio", f.PBRatio},
		{"dividend_yield", f.DividendYield},
		{"eps", f.EPS},
		{"beta", f.Beta},
		{"roe", f.ROE},
		{"debt_to_equity", f.DebtToEquity},
		{"price", f.Price},
		{"year_high", f.YearHigh},
		{"year_low", f.YearLow},
	}
	var missing []string
	for _, m := range metrics {
		if m.val == nil {
			missing = append(missing, m.name)
		}
	}
	pb := &marketdatav1.Fundamentals{
		Symbol:         f.Symbol,
		MarketCap:      derefOrZero(f.MarketCap),
		PeRatio:        derefOrZero(f.PERatio),
		PbRatio:        derefOrZero(f.PBRatio),
		DividendYield:  derefOrZero(f.DividendYield),
		Eps:            derefOrZero(f.EPS),
		Beta:           derefOrZero(f.Beta),
		Roe:            derefOrZero(f.ROE),
		DebtToEquity:   derefOrZero(f.DebtToEquity),
		Price:          derefOrZero(f.Price),
		YearHigh:       derefOrZero(f.YearHigh),
		YearLow:        derefOrZero(f.YearLow),
		ExtraMetrics:   f.ExtraMetrics,
		Currency:       f.Currency,
		Source:         src,
		Stale:          stale,
		MissingMetrics: missing,
	}
	if !f.AsOf.IsZero() {
		pb.AsOf = timestamppb.New(f.AsOf)
	}
	return pb
}
