package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

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
}

// NewMarketDataService creates the service and dials ledger + notify.
func NewMarketDataService(
	registry *source.Registry,
	repo *repository.MarketDataRepo,
	cfgWatcher *config.Watcher,
	ledgerEndpoint string,
	notifyEndpoint string,
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
		registry:    registry,
		repo:        repo,
		cfg:         cfgWatcher,
		ledger:      ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:      notifyv1.NewNotifyServiceClient(notifyConn),
		barSubs:     make(map[string]chan *marketdatav1.Bar),
		quoteSubs:   make(map[string]chan *marketdatav1.Quote),
		warmSymbols: make(map[string]struct{}),
	}, nil
}

// GetBars retrieves historical OHLCV bars, querying from TimescaleDB.
func (s *MarketDataService) GetBars(ctx context.Context, req *marketdatav1.GetBarsRequest) (*marketdatav1.GetBarsResponse, error) {
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
		start = end.Add(-24 * time.Hour)
	}

	pageSize := 500
	pageToken := ""
	if req.Page != nil {
		if req.Page.PageSize > 0 {
			pageSize = int(req.Page.PageSize)
		}
		pageToken = req.Page.PageToken
	}

	bars, nextToken, err := s.repo.QueryBars(ctx, req.Symbol, req.Timeframe, start, end, pageSize, pageToken) //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	if err != nil {
		return nil, fmt.Errorf("query bars: %w", err)
	}
	return &marketdatav1.GetBarsResponse{
		Bars: bars,
		Page: &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
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
			for _, sym := range symbols {
				q, err := src.GetLatestQuote(ctx, sym)
				if err != nil {
					continue
				}
				if err := s.repo.InsertQuote(ctx, q); err != nil {
					slog.Warn("warm poller: cache insert failed", "symbol", sym, "error", err)
				}
			}
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

	batchSize := int(s.cfg.GetInt("marketdata.backfill.batch_size", 1000))
	_ = batchSize // used as hint; Alpaca API handles pagination internally

	s.emitEvent(ctx, "marketdata.backfill.started", "marketdata:backfill", map[string]interface{}{
		"symbols":   req.Symbols,
		"timeframe": req.Timeframe, //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
	})

	var totalWritten int64
	var failedSymbols []string

	src, err := s.registry.Get("")
	if err != nil {
		return nil, fmt.Errorf("resolve source: %w", err)
	}

	for _, sym := range req.Symbols {
		bars, err := src.GetBars(ctx, sym, req.Timeframe, start, end) //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
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
		ExpectedBars:  estimateExpectedBars(req.Symbols, req.Timeframe, start, end), //nolint:staticcheck // SA1019: string timeframe read during one-release deprecation window (053)
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
	case "5m", "5Min":
		perDay = 78
	case "1m", "1Min":
		perDay = 390
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
		for bar := range feed {
			_ = s.repo.InsertBars(ctx, []*marketdatav1.Bar{bar})
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
