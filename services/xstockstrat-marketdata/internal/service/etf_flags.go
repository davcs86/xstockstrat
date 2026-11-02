package service

import (
	"context"
	"log/slog"
	"sync"
	"time"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/middleware"
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
	// etfFlagLogEvery is the fill-log rate-limit window: a fixed invariant, not a config key.
	etfFlagLogEvery = time.Minute
)

// etfFillItem carries the enqueuing request's trace id to the filler; the request ctx never crosses over.
type etfFillItem struct{ sym, traceID string }

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
	queue   chan etfFillItem
	now     func() time.Time
	// Fill-log rate-limit slots, guarded by mu.
	lastSkipReason     string
	budgetLoggedAt     time.Time
	failLoggedAt       map[string]time.Time
	unlabelledLoggedAt time.Time
}

// SetEtfFlagSource wires the FMP profile reader; it must be the same *fmp.Client as the fundamentals
// path so the background fill spends the one shared day budget.
func (s *MarketDataService) SetEtfFlagSource(src etfFlagSource) {
	s.etf.mu.Lock()
	defer s.etf.mu.Unlock()
	s.etf.src = src
	s.etf.entries = map[string]etfFlagEntry{}
	s.etf.pending = map[string]struct{}{}
	s.etf.failLoggedAt = map[string]time.Time{}
	s.etf.queue = make(chan etfFillItem, etfFlagQueueCap)
}

func (e *etfFlagState) clock() time.Time {
	if e.now != nil {
		return e.now()
	}
	return time.Now()
}

// GetEtfFlags serves cached labels only and never calls FMP; a miss (or expired entry) is unset and
// queued for the background filler.
func (s *MarketDataService) GetEtfFlags(ctx context.Context, req *marketdatav1.GetEtfFlagsRequest) (*marketdatav1.GetEtfFlagsResponse, error) {
	symbols := normalizeSymbols(req.GetSymbols())
	resp := &marketdatav1.GetEtfFlagsResponse{Flags: make([]*marketdatav1.EtfFlag, 0, len(symbols))}
	now := s.etf.clock()
	tid := middleware.FromContext(ctx).TraceID
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
			s.etf.enqueueLocked(sym, tid)
		}
		resp.Flags = append(resp.Flags, flag)
	}
	return resp, nil
}

func (e *etfFlagState) enqueueLocked(sym, traceID string) {
	if e.queue == nil {
		return
	}
	if _, ok := e.pending[sym]; ok {
		return
	}
	select {
	case e.queue <- etfFillItem{sym: sym, traceID: traceID}:
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
		case item := <-q:
			s.fillEtfFlag(ctx, item)
		}
	}
}

// fillEtfFlag logs only after releasing etf.mu, and never logs the error text (it can carry apikey=).
func (s *MarketDataService) fillEtfFlag(ctx context.Context, item etfFillItem) {
	sym := item.sym
	defer func() {
		s.etf.mu.Lock()
		delete(s.etf.pending, sym)
		s.etf.mu.Unlock()
	}()
	attrs := func(kv ...any) []any {
		a := append([]any{"symbol", sym}, kv...)
		if item.traceID != "" {
			a = append(a, "trace_id", item.traceID)
		}
		return a
	}
	reason, used, cap, snap := s.etfFillGate()
	s.etf.mu.Lock()
	if reason != "" {
		log := s.etf.skipLogLocked(reason)
		s.etf.mu.Unlock()
		if log {
			kv := []any{"reason", reason}
			if snap {
				kv = append(kv, "used", used, "cap", cap)
			}
			slog.InfoContext(ctx, "etf flag fill skipped", attrs(kv...)...)
		}
		return
	}
	s.etf.lastSkipReason = ""
	s.etf.mu.Unlock()
	isEtf, err := s.etf.src.FetchIsEtf(ctx, sym)
	if err != nil {
		class := fmp.ErrorClass(err)
		s.etf.mu.Lock()
		log := s.etf.failLogLocked(class)
		s.etf.mu.Unlock()
		if log {
			slog.InfoContext(ctx, "etf flag fill failed", attrs("class", class)...)
		}
		return
	}
	now := s.etf.clock()
	s.etf.mu.Lock()
	if _, exists := s.etf.entries[sym]; !exists && len(s.etf.entries) >= etfFlagCacheMax {
		s.etf.evictOldestLocked()
	}
	s.etf.entries[sym] = etfFlagEntry{isEtf: isEtf, fetchedAt: now}
	log := isEtf == nil && s.etf.unlabelledLogLocked()
	s.etf.mu.Unlock()
	if log {
		slog.InfoContext(ctx, "etf flag fill unlabelled", attrs()...)
	}
}

// etfFillGate gates the best-effort fill: FMP on, a real (cap > 0) budget, and below the 80% mark so the
// label never spends the snapshot path's headroom. It takes fmp.Client.mu, so never call it under etf.mu.
func (s *MarketDataService) etfFillGate() (reason string, used, cap int, snap bool) {
	if s.etf.src == nil || s.fundCfg == nil {
		return "not_wired", 0, 0, false
	}
	if !s.fundCfg.GetBool("marketdata.fmp.enabled", false) {
		return "fmp_disabled", 0, 0, false
	}
	if s.fmpBudget == nil {
		return "not_wired", 0, 0, false
	}
	used, cap = s.fmpBudget.BudgetSnapshot()
	switch {
	case cap <= 0:
		return "no_cap", used, cap, true
	case atQuotaAlertThreshold(used, cap):
		return "budget", used, cap, true
	}
	return "", used, cap, true
}

// skipLogLocked logs a config reason on change and "budget" at most once per etfFlagLogEvery.
func (e *etfFlagState) skipLogLocked(reason string) bool {
	now := e.clock()
	if reason == e.lastSkipReason && (reason != "budget" || now.Sub(e.budgetLoggedAt) < etfFlagLogEvery) {
		return false
	}
	e.lastSkipReason = reason
	if reason == "budget" {
		e.budgetLoggedAt = now
	}
	return true
}

// failLogLocked keeps one slot per class; the map is bounded by fmp.ErrorClass's finite output.
func (e *etfFlagState) failLogLocked(class string) bool {
	now := e.clock()
	if now.Sub(e.failLoggedAt[class]) < etfFlagLogEvery {
		return false
	}
	e.failLoggedAt[class] = now
	return true
}

func (e *etfFlagState) unlabelledLogLocked() bool {
	now := e.clock()
	if now.Sub(e.unlabelledLoggedAt) < etfFlagLogEvery {
		return false
	}
	e.unlabelledLoggedAt = now
	return true
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
