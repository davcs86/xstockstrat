package service

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
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

	// warmSymbols is the set of symbols GetLatestQuote has been asked for; a
	// background poller (StartWarmQuotePoller) keeps their latest quote fresh in
	// the DB so subsequent reads hit the cache instead of a live Alpaca call.
	warmMu      sync.Mutex
	warmSymbols map[string]struct{}

	// fundamentals is the active fundamentals source (feature 059; provider made
	// switchable by feature 129), held separately from the OHLCV registry (FR-2).
	// Always non-nil since feature 082 — marketdata.<fundProvider>.enabled gates use
	// (fundamentalsEnabled()), not construction.
	fundamentals source.FundamentalsSource
	// fundProvider names the active fundamentals provider ("fmp" or "finnhub"),
	// frozen once at construction (never re-read live) — see NewMarketDataService.
	fundProvider string
	// fundCfg / fundRepo are the config + repo surfaces the fundamentals RPCs use,
	// behind interfaces so the cache/quota/gate logic is unit-testable with stubs.
	fundCfg  fundamentalsConfig
	fundRepo fundamentalsRepo
	// quotaAlert dedupes the FR-7 80%-quota WARNING to one emit per active window
	// (a UTC day for FMP, a rolling rate_window_seconds for Finnhub — see
	// maybeAlertQuota/fundamentalsQuota).
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

// NewMarketDataService creates the service and dials ledger + notify. fundamentals is
// the active fundamentals source, always non-nil via the sole boot-time construction
// path since feature 082 (cmd/server/main.go's newFundamentalsSource). provider names
// which source it is ("fmp" or "finnhub", feature 129) — frozen here, never re-read
// live, so the client object and the config-key dispatch it drives can never diverge.
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
		registry:     registry,
		repo:         repo,
		cfg:          cfgWatcher,
		ledger:       ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:       notifyv1.NewNotifyServiceClient(notifyConn),
		barSubs:      make(map[string]chan *marketdatav1.Bar),
		quoteSubs:    make(map[string]chan *marketdatav1.Quote),
		warmSymbols:  make(map[string]struct{}),
		fundamentals: fundamentals,
		fundProvider: provider,
		fundCfg:      cfgWatcher,
		fundRepo:     repo,
	}, nil
}

// GetBars retrieves historical OHLCV bars, querying from TimescaleDB.
func (s *MarketDataService) GetBars(ctx context.Context, req *marketdatav1.GetBarsRequest) (*marketdatav1.GetBarsResponse, error) {
	// A charted symbol becomes "warm" so the always-on bar ingester keeps it fresh.
	s.markWarm(req.Symbol)

	// Normalize the requested interval to the canonical DB spelling ("1Day"→"1d",
	// "15Min"→"15m", …). The always-on ingester and backfill store canonical strings;
	// without this, QueryBars searches for the literal alias and never matches them, so
	// the chart renders empty for every ingested symbol. Unresolvable inputs (e.g. the
	// dead "10Min"/"30Min" aliases) fall back to the raw string — they have no stored
	// bars either way. Prefer timeframe_enum; fall back to the deprecated string field.
	legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	canonicalTf := legacyTf
	if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil {
		canonicalTf = c
	}

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
	if end.IsZero() {
		end = time.Now()
	}
	if start.IsZero() {
		// Size the implicit history window to the requested page of bars for this
		// timeframe — not a flat 24h, which yields ~0 bars for a 1d/1h chart (a daily
		// chart requested on a weekend has no bar inside the last 24h at all). The 3×
		// slack absorbs weekends/holidays/market-closed gaps so a full page still loads.
		start = end.Add(-defaultBarLookback(canonicalTf, pageSize))
	}

	bars, nextToken, err := s.repo.QueryBars(ctx, req.Symbol, canonicalTf, start, end, pageSize, pageToken)
	if err != nil {
		return nil, fmt.Errorf("query bars: %w", err)
	}

	// DB miss on the first page — fall back to a live Alpaca fetch, cache the result,
	// and re-read so pagination stays consistent. Without this the chart stays empty
	// until an explicit backfill runs, even though the data is one REST call away.
	// (Mirrors GetLatestQuote's live fallback.) Only on the first page: an empty later
	// page means end-of-data, not a miss.
	if len(bars) == 0 && pageToken == "" {
		bars, nextToken = s.fetchAndCacheBars(ctx, req.Symbol, canonicalTf, start, end, pageSize)
	}

	return &marketdatav1.GetBarsResponse{
		Bars: bars,
		Page: &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
}

// fetchAndCacheBars fetches bars for a symbol from the live source, persists them, and
// returns the first page from the DB (so the next_page_token is consistent with a normal
// cached read). On any failure it logs and returns no bars — GetBars then yields an empty
// (but valid) response rather than erroring. If caching fails the freshly fetched bars are
// still served, truncated to pageSize.
func (s *MarketDataService) fetchAndCacheBars(ctx context.Context, symbol, tf string, start, end time.Time, pageSize int) ([]*marketdatav1.Bar, string) {
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
		// Serve what we fetched even if caching failed.
		if len(live) > pageSize {
			return live[:pageSize], ""
		}
		return live, ""
	}
	bars, nextToken, err := s.repo.QueryBars(ctx, symbol, tf, start, end, pageSize, "")
	if err != nil {
		slog.Warn("GetBars: re-read after cache failed", "symbol", symbol, "error", err)
		if len(live) > pageSize {
			return live[:pageSize], ""
		}
		return live, ""
	}
	return bars, nextToken
}

// defaultBarLookback sizes the implicit history window (when the caller supplies no
// explicit range) to cover at least `bars` bars of the given canonical timeframe, times a
// slack multiplier so non-continuous market hours (overnight gaps, weekends, holidays)
// still yield a full page. Unknown timeframes fall back to a day-sized interval.
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

// GetDataCoverage reports stored OHLCV coverage (earliest/latest/count + gaps) for a
// symbol+timeframe. Read-only DB query — no outbound gRPC call, so no header propagation needed.
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

// resolveDeletePlan validates a delete request and computes the scoped (timeframe, start, end)
// to hand to the repo. Pure: it takes the propagated access scope and the configured
// max-delete-days directly (not a ctx or config.Watcher) so the FR-5 guards — symbol required,
// admin-only (0x04), and the optional delete-window cap — are unit-testable without a DB or
// config server. Returns connect-coded errors that the handler forwards.
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
// The symbol is required (server-side guard against an unbounded delete); range and timeframe
// are optional. A whole-symbol delete (no range) is allowed at the server — the UI double-confirms
// it — but is still bounded by the symbol predicate. Emits an audit ledger event.
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

// markWarm adds a symbol to the warm set polled by StartWarmQuotePoller.
func (s *MarketDataService) markWarm(symbol string) {
	if symbol == "" {
		return
	}
	s.warmMu.Lock()
	s.warmSymbols[symbol] = struct{}{}
	s.warmMu.Unlock()
}

// StartWarmQuotePoller periodically refreshes the latest quote for every symbol
// that has been queried via GetLatestQuote, writing it to the DB so reads serve
// from the cache instead of a live Alpaca call. Interval is configurable via
// marketdata.stream.warm_interval_ms (default 30s); set to 0 to pause.
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
			// Per-symbol fetch errors used to be dropped silently, which hid
			// whole-feed failures (e.g. invalid/placeholder Alpaca credentials, where
			// every call gets the same 401). Surface them once per cycle with a sample
			// error instead of staying quiet — a high failed count with fetched==0 is
			// the signature of a credential/feed problem, not a bad ticker.
			if failed > 0 {
				slog.Warn("warm poller: per-symbol quote fetch failures",
					"failed", failed, "fetched", fetched, "total", len(symbols), "sample_error", firstErr)
			}
		}
	}
}

// StartBarIngestPoller continuously ingests recent bars for every symbol that has been
// queried (the same warm set StartWarmQuotePoller tracks — populated by GetLatestQuote and
// GetBars), upserting them into marketdata.ohlcv. This gives the platform an always-on feed
// instead of one that only runs while a client holds a StreamBars RPC open. Interval is
// configurable via marketdata.stream.bar_ingest_interval_ms (default 60s); set to 0 to pause.
func (s *MarketDataService) StartBarIngestPoller(ctx context.Context) {
	const defaultIntervalMs = 60000
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

// defaultBarIngestTimeframe is the declared default of
// marketdata.stream.bar_ingest_timeframe (see the service CLAUDE.md config table).
//
// This is a comma-separated LIST, not a single timeframe (bug fix): the always-on ingester
// used to fetch only one timeframe ("15m"), so any continuously-live consumer of "1d" bars
// (the live loop's _eval_pair, the screener's technical criteria) only ever got a symbol's
// "1d" row from its initial on-demand backfill — GetBars's live-fallback only fires on a
// first-page DB cache MISS, so once that one row existed it was never refreshed again, and
// every later evaluation ran against a frozen, increasingly-stale daily bar. "1d" is now
// ingested continuously alongside "15m" so both stay current. Existing single-timeframe
// config values ("15m") remain valid — they just become a one-element list.
const defaultBarIngestTimeframe = "15m,1d"

// resolveIngestTimeframes parses+canonicalizes the configured bar-ingest timeframe list.
// Bars fetched with these values are PERSISTED (InsertBars), so an out-of-vocabulary config
// entry would write rows that no GetBars query can ever match (MARKETDATA-1). Empty means
// "not configured" and falls back silently; an unresolvable entry is skipped with a WARN
// (once per cycle) rather than aborting the whole list. If nothing resolves, falls back to
// the default list. Dedupes so a caller listing the same timeframe twice doesn't double-fetch.
// The documented way to pause ingestion is bar_ingest_interval_ms <= 0 (MARKETDATA-5), never
// a bogus timeframe.
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

// minIngestLookback is the floor lookback window for a given canonical timeframe,
// regardless of the configured marketdata.stream.bar_ingest_lookback_ms: that key is sized
// for the 15m default (900000ms = 15min) and is far too short to ever re-cover a "1d" bar
// (whose own interval is 24h) — using it unmodified for "1d" would ingest an empty window on
// almost every cycle and reproduce this same staleness bug for daily bars. 2x the
// timeframe's own interval comfortably covers the current (possibly still-open) session
// plus the prior one, so a weekend/holiday gap still self-heals on the next trading day.
func minIngestLookback(canonicalTf string) time.Duration {
	interval := timeframe.Interval(canonicalTf)
	if interval <= 0 {
		return 0
	}
	return 2 * interval
}

// ingestRecentBars fetches the recent bar window for every warm symbol, for every
// configured ingest timeframe, and upserts it. The lookback
// (marketdata.stream.bar_ingest_lookback_ms, default 15m) is re-fetched each cycle;
// overlap is harmless because InsertBars upserts, and a window wider than the poll interval
// lets the feed self-heal after a brief pause or restart. Each timeframe's actual window is
// at least minIngestLookback(tf) — see its doc comment for why the flat configured value
// alone isn't sufficient for anything coarser than "15m".
func (s *MarketDataService) ingestRecentBars(ctx context.Context) {
	s.warmMu.Lock()
	symbols := make([]string, 0, len(s.warmSymbols))
	for sym := range s.warmSymbols {
		symbols = append(symbols, sym)
	}
	s.warmMu.Unlock()
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

	// The per-request bar limit (marketdata.backfill.batch_size) and rate limit are
	// applied inside the Alpaca client (configured at startup); pagination is handled
	// transparently by GetBars/GetBarsMulti, so no batching is needed here.

	// Resolve once, same raw-fallback shape as GetBars (feature 080 FR-11). Previously
	// every site below read req.Timeframe raw and never called Resolve, so an enum-only
	// caller (Timeframe unset) reached Alpaca with "" and persisted rows GetBars could
	// never find again. Kept as a fallback rather than an error for consistency with
	// GetBars (design Open Risk 2).
	legacyTf := req.Timeframe //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	canonicalTf := legacyTf
	if c, rErr := timeframe.Resolve(req.GetTimeframeEnum(), legacyTf); rErr == nil {
		canonicalTf = c
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

// estimateExpectedBars approximates the total bar count across the requested
// symbols/range, used by xstockstrat-ingest as a progress denominator (FR-6).
// It counts weekdays (Mon–Fri) in [start, end] as a trading-day approximation
// (a US-holiday calendar is out of scope for a progress estimate) and multiplies
// by a per-day bar factor keyed off the timeframe and by the number of symbols.
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
		// Streamed bars are Alpaca's native 1-minute bars (see alpaca.streamBarTimeframe);
		// they are forwarded to live subscribers only. Persisting the platform's continuously
		// ingested timeframes (marketdata.stream.bar_ingest_timeframe, default "15m,1d") is
		// owned by the always-on REST bar ingester (StartBarIngestPoller), so we do not write
		// streamed minute bars into the ohlcv table here. "1h" is not continuously ingested —
		// it is only ever populated on demand (GetBars' live-fallback) or by an explicit
		// backfill.
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

// ── Fundamentals (feature 059; provider made switchable by feature 129) ─────
// Read-through cache → quota guard → provider fetch → 80%-quota WARNING, mirroring
// the GetBars/fetchAndCacheBars idiom. The active provider (s.fundProvider, "fmp" or
// "finnhub") is gated behind marketdata.<fundProvider>.enabled and reached only via
// this service (the single fundamentals chokepoint).

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

// fundamentalsEnabled returns FailedPrecondition when the active fundamentals provider
// is disabled (or unbuilt), making NO external call (FR-6). Since feature 082,
// s.fundamentals is always non-nil via the sole construction path (cmd/server/main.go's
// newFundamentalsSource) — the "|| s.fundamentals == nil" half of this guard is
// defensive-only and not reachable through that path today; kept in case a future
// caller constructs the service directly with a nil source.
func (s *MarketDataService) fundamentalsEnabled() error {
	if !s.fundCfg.GetBool("marketdata."+s.fundProvider+".enabled", false) || s.fundamentals == nil {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s fundamentals source disabled", s.fundProvider))
	}
	return nil
}

// fundamentalsQuota returns the active provider's current fetch count, cap, and window
// (seconds) for the 80%-WARNING/at-cap logic. FMP keeps its exact pre-existing daily-cap
// shape (unchanged config key, unchanged repo method); Finnhub uses the new rolling
// window (feature 129).
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

// maybeAlertQuota emits one WARNING per active window (see fundamentalsQuota) once the
// fetch count crosses 80% of the cap (FR-7). Uses the request ctx so the propagation
// interceptor carries headers. The dedup bucket is a window-floor, not a UTC-date
// string — for FMP's 86400s window this is UTC-midnight-aligned (Unix epoch starts at
// UTC midnight), identical behavior to the pre-feature-129 UTC-day dedup; for a shorter
// window (e.g. Finnhub's 60s) it correctly re-fires once per new window instead of
// firing once and going silent until the next UTC day.
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

// fundamentalMetricPtr names one of source.Fundamentals' 11 nullable metric fields
// alongside its canonical wire name (matches marketdata.proto's field names verbatim,
// which in turn matches analysis' screener `_FUNDAMENTAL_FIELDS` metric_name set).
type fundamentalMetricPtr struct {
	name string
	val  *float64
}

// derefOrZero reads a nullable metric for the proto's plain-double field — the wire
// value is 0.0 when nil, exactly like before this fix. The actual presence signal is
// missing_metrics, appended separately by toProtoFundamentals; callers must not infer
// "present" from a non-zero reading alone.
func derefOrZero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// toProtoFundamentals maps the internal source.Fundamentals to the wire message. It is
// a method (not a free function) so its empty-Source fallback can name the actually
// active provider (feature 129) instead of hardcoding "fmp".
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
