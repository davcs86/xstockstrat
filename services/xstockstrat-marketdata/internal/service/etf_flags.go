package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// etfFlagSource reads a symbol's vendor ETF flag through the shared FMP gateway (nil = empty profile).
type etfFlagSource interface {
	FetchIsEtf(ctx context.Context, symbol string) (*bool, error)
}

const (
	// etfFlagTTL is long and fixed: ETF status almost never changes and the label is best-effort,
	// so a refresh must not compete with the snapshot path for the shared FMP day budget.
	etfFlagTTL = 30 * 24 * time.Hour
	// etfFlagCacheMax bounds cache memory; the oldest entry is evicted before an insert at the bound.
	etfFlagCacheMax = 10000
	// etfFlagQueueCap bounds pending background fills; GetEtfFlags drops (never blocks) when full.
	etfFlagQueueCap = 256
)

type etfFlagEntry struct {
	isEtf     *bool
	fetchedAt time.Time
}

// etfFlagState is the cache-only ETF label (feature 215); zero value = no source wired.
type etfFlagState struct {
	src     etfFlagSource
	mu      sync.Mutex
	entries map[string]etfFlagEntry
	pending map[string]struct{}
	queue   chan string
	now     func() time.Time
}

// SetEtfFlagSource wires the FMP profile reader; it must be the same *fmp.Client as the fundamentals
// path so the background fill spends the one shared day budget.
func (s *MarketDataService) SetEtfFlagSource(src etfFlagSource) {
	s.etf.mu.Lock()
	defer s.etf.mu.Unlock()
	s.etf.src = src
	s.etf.entries = map[string]etfFlagEntry{}
	s.etf.pending = map[string]struct{}{}
	s.etf.queue = make(chan string, etfFlagQueueCap)
}

func (e *etfFlagState) clock() time.Time {
	if e.now != nil {
		return e.now()
	}
	return time.Now()
}

// GetEtfFlags serves cached labels only and never calls FMP; a miss (or expired entry) is unset and
// queued for the background filler.
func (s *MarketDataService) GetEtfFlags(_ context.Context, req *marketdatav1.GetEtfFlagsRequest) (*marketdatav1.GetEtfFlagsResponse, error) {
	symbols := normalizeSymbols(req.GetSymbols())
	resp := &marketdatav1.GetEtfFlagsResponse{Flags: make([]*marketdatav1.EtfFlag, 0, len(symbols))}
	now := s.etf.clock()
	s.etf.mu.Lock()
	defer s.etf.mu.Unlock()
	for _, sym := range symbols {
		flag := &marketdatav1.EtfFlag{Symbol: sym}
		if e, ok := s.etf.entries[sym]; ok && now.Sub(e.fetchedAt) < etfFlagTTL {
			if e.isEtf != nil {
				v := *e.isEtf
				flag.IsEtf = &v
			}
		} else {
			s.etf.enqueueLocked(sym)
		}
		resp.Flags = append(resp.Flags, flag)
	}
	return resp, nil
}

func (e *etfFlagState) enqueueLocked(sym string) {
	if e.queue == nil {
		return
	}
	if _, ok := e.pending[sym]; ok {
		return
	}
	select {
	case e.queue <- sym:
		e.pending[sym] = struct{}{}
	default:
	}
}

// StartEtfFlagFiller drains the label queue until ctx is done.
func (s *MarketDataService) StartEtfFlagFiller(ctx context.Context) {
	s.etf.mu.Lock()
	q := s.etf.queue
	s.etf.mu.Unlock()
	if q == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case sym := <-q:
			s.fillEtfFlag(ctx, sym)
		}
	}
}

func (s *MarketDataService) fillEtfFlag(ctx context.Context, sym string) {
	defer func() {
		s.etf.mu.Lock()
		delete(s.etf.pending, sym)
		s.etf.mu.Unlock()
	}()
	if !s.etfFillAllowed() {
		return
	}
	isEtf, err := s.etf.src.FetchIsEtf(ctx, sym)
	if err != nil {
		slog.DebugContext(ctx, "etf flag fill failed", "symbol", sym, "error", err)
		return
	}
	now := s.etf.clock()
	s.etf.mu.Lock()
	defer s.etf.mu.Unlock()
	if _, exists := s.etf.entries[sym]; !exists && len(s.etf.entries) >= etfFlagCacheMax {
		s.etf.evictOldestLocked()
	}
	s.etf.entries[sym] = etfFlagEntry{isEtf: isEtf, fetchedAt: now}
}

// etfFillAllowed gates the best-effort fill: FMP on, a real (cap > 0) budget, and below the 80% mark
// so the label never spends the headroom the snapshot path needs.
func (s *MarketDataService) etfFillAllowed() bool {
	if s.etf.src == nil || s.fundCfg == nil || !s.fundCfg.GetBool("marketdata.fmp.enabled", false) || s.fmpBudget == nil {
		return false
	}
	used, cap := s.fmpBudget.BudgetSnapshot()
	return cap > 0 && !atQuotaAlertThreshold(used, cap)
}

func (e *etfFlagState) evictOldestLocked() {
	var oldest string
	var oldestAt time.Time
	for sym, entry := range e.entries {
		if oldest == "" || entry.fetchedAt.Before(oldestAt) {
			oldest, oldestAt = sym, entry.fetchedAt
		}
	}
	delete(e.entries, oldest)
}
