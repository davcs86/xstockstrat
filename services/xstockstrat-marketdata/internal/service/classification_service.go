package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/classification"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/repository"
)

// classificationStore is the SCD persistence surface (feature 217), stub-able in tests.
type classificationStore interface {
	CurrentSectors(ctx context.Context, symbols []string) (map[string]string, error)
	SectorAsOf(ctx context.Context, symbol string, ts time.Time) (string, bool, error)
	SectorHistory(ctx context.Context, symbols []string, start, end *time.Time) ([]repository.ClassificationRow, error)
	SeedEpoch(ctx context.Context, symbol, sector string) (bool, error)
	ApplyObservation(ctx context.Context, symbol, sector string, now time.Time) (classification.Action, error)
}

// sectorSource fetches a symbol's vendor sector text through the shared FMP gateway.
type sectorSource interface {
	FetchSector(ctx context.Context, symbol string) (string, error)
}

// fmpBudget exposes the shared FMP UTC-day budget (the one throttle authority on fmp.Client).
type fmpBudget interface {
	BudgetSnapshot() (used, dailyCap int)
}

// classificationState holds the feature-217 wiring; zero value = classification disabled.
type classificationState struct {
	store  classificationStore
	sector sectorSource
	now    func() time.Time

	demandMu sync.Mutex
	demand   map[string]struct{}
}

// SetClassification wires the SCD store, the FMP sector source and the shared FMP budget. All three
// FMP consumers (fundamentals, enrichment, classification) must be backed by the same *fmp.Client.
func (s *MarketDataService) SetClassification(store classificationStore, src sectorSource, budget fmpBudget) {
	s.class.store = store
	s.class.sector = src
	s.fmpBudget = budget
}

func (s *MarketDataService) classNow() time.Time {
	if s.class.now != nil {
		return s.class.now()
	}
	return time.Now().UTC()
}

// markClassDemand records symbols read through the classification RPCs so the refresh job
// classifies them on its next cycle (separate from the quote warm set — no quote polling side effect).
func (s *MarketDataService) markClassDemand(symbols ...string) {
	s.class.demandMu.Lock()
	defer s.class.demandMu.Unlock()
	if s.class.demand == nil {
		s.class.demand = map[string]struct{}{}
	}
	for _, sym := range symbols {
		if sym != "" {
			s.class.demand[sym] = struct{}{}
		}
	}
}

func (s *MarketDataService) classificationUniverse() []string {
	set := map[string]struct{}{}
	for _, sym := range s.warmSnapshot() {
		set[sym] = struct{}{}
	}
	s.class.demandMu.Lock()
	for sym := range s.class.demand {
		set[sym] = struct{}{}
	}
	s.class.demandMu.Unlock()
	out := make([]string, 0, len(set))
	for sym := range set {
		out = append(out, sym)
	}
	return out
}

func normalizeSymbols(in []string) []string {
	out := make([]string, 0, len(in))
	for _, sym := range in {
		if s := strings.ToUpper(strings.TrimSpace(sym)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// GetCurrentSector serves open-row sectors from the local store only; unclassified → UNSPECIFIED.
func (s *MarketDataService) GetCurrentSector(ctx context.Context, req *marketdatav1.GetCurrentSectorRequest) (*marketdatav1.GetCurrentSectorResponse, error) {
	symbols := normalizeSymbols(req.GetSymbols())
	resp := &marketdatav1.GetCurrentSectorResponse{}
	if len(symbols) == 0 {
		return resp, nil
	}
	if s.class.store == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("classification store not configured"))
	}
	s.markClassDemand(symbols...)
	current, err := s.class.store.CurrentSectors(ctx, symbols)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, sym := range symbols {
		resp.Sectors = append(resp.Sectors, &marketdatav1.SymbolSector{Symbol: sym, Sector: classification.FromStoredName(current[sym])})
	}
	return resp, nil
}

// GetSectorAsOf serves the point-in-time sector; no covering version → UNSPECIFIED.
func (s *MarketDataService) GetSectorAsOf(ctx context.Context, req *marketdatav1.GetSectorAsOfRequest) (*marketdatav1.GetSectorAsOfResponse, error) {
	symbol := strings.ToUpper(strings.TrimSpace(req.GetSymbol()))
	if symbol == "" || req.GetAsOf() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("symbol and as_of are required"))
	}
	if s.class.store == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("classification store not configured"))
	}
	s.markClassDemand(symbol)
	sector, found, err := s.class.store.SectorAsOf(ctx, symbol, req.GetAsOf().AsTime())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if !found {
		return &marketdatav1.GetSectorAsOfResponse{Sector: commonv1.Sector_SECTOR_UNSPECIFIED}, nil
	}
	return &marketdatav1.GetSectorAsOfResponse{Sector: classification.FromStoredName(sector)}, nil
}

// GetSectorHistory returns every version intersecting the range — analysis snapshots this once per
// symbol per backtest and resolves each bar locally.
func (s *MarketDataService) GetSectorHistory(ctx context.Context, req *marketdatav1.GetSectorHistoryRequest) (*marketdatav1.GetSectorHistoryResponse, error) {
	symbols := normalizeSymbols(req.GetSymbols())
	resp := &marketdatav1.GetSectorHistoryResponse{}
	if len(symbols) == 0 {
		return resp, nil
	}
	if s.class.store == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("classification store not configured"))
	}
	s.markClassDemand(symbols...)
	var start, end *time.Time
	if req.GetStart() != nil {
		t := req.GetStart().AsTime()
		start = &t
	}
	if req.GetEnd() != nil {
		t := req.GetEnd().AsTime()
		end = &t
	}
	rows, err := s.class.store.SectorHistory(ctx, symbols, start, end)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, r := range rows {
		out := &marketdatav1.SectorHistoryRow{
			Symbol:    r.Symbol,
			Sector:    classification.FromStoredName(r.Sector),
			ValidFrom: timestamppb.New(r.ValidFrom),
			Source:    r.Source,
		}
		if r.ValidTo != nil {
			out.ValidTo = timestamppb.New(*r.ValidTo)
		}
		resp.Rows = append(resp.Rows, out)
	}
	return resp, nil
}

// RefreshClassifications runs one refresh cycle over the universe: fetch the vendor sector through
// the throttled FMP gateway and apply the SCD three-way branch. A cap hit ends the cycle early; a
// per-symbol vendor failure is skipped (the store keeps serving the last known sector).
func (s *MarketDataService) RefreshClassifications(ctx context.Context, symbols []string) (applied int) {
	if s.class.store == nil || s.class.sector == nil {
		return 0
	}
	for _, sym := range symbols {
		if ctx.Err() != nil {
			return applied
		}
		text, err := s.class.sector.FetchSector(ctx, sym)
		if errors.Is(err, fmp.ErrFMPDailyCapExceeded) {
			slog.Warn("classification refresh: FMP daily cap reached, ending cycle", "remaining", len(symbols)-applied)
			return applied
		}
		if err != nil {
			slog.Warn("classification refresh: sector fetch failed", "symbol", sym, "error", err)
			continue
		}
		sector, ok := classification.MapFMPSector(text)
		if !ok {
			continue // unknown/empty vendor sector → no write, never a bogus row
		}
		if _, err := s.class.store.ApplyObservation(ctx, sym, classification.StoredName(sector), s.classNow()); err != nil {
			slog.Warn("classification refresh: SCD write failed", "symbol", sym, "error", err)
			continue
		}
		applied++
	}
	return applied
}

// StartClassificationRefreshPoller refreshes classifications every
// marketdata.classification.refresh_interval_hours while marketdata.classification.enabled is true.
// Runs on the long-lived main ctx: background work carries no propagation headers by design.
func (s *MarketDataService) StartClassificationRefreshPoller(ctx context.Context) {
	const defaultHours = 24
	// First cycle shortly after boot so a fresh deploy seeds without waiting a full interval.
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	interval := time.Minute
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			hours := s.cfg.GetInt("marketdata.classification.refresh_interval_hours", defaultHours)
			if hours <= 0 || !s.cfg.GetBool("marketdata.classification.enabled", false) {
				continue // paused via config
			}
			if next := time.Duration(hours) * time.Hour; next != interval {
				interval = next
				ticker.Reset(interval)
			}
			n := s.RefreshClassifications(ctx, s.classificationUniverse())
			slog.Info("classification refresh cycle complete", "applied", n)
		}
	}
}

// seedFromProfile is the fundamentals-profile write-through: a fetched FMP profile carrying a
// mappable sector epoch-seeds a symbol that has no open row (same no-open-row branch as the job).
func (s *MarketDataService) seedFromProfile(ctx context.Context, symbol, sectorText string) {
	if s.class.store == nil || sectorText == "" {
		return
	}
	sector, ok := classification.MapFMPSector(sectorText)
	if !ok {
		return
	}
	if _, err := s.class.store.SeedEpoch(ctx, strings.ToUpper(symbol), classification.StoredName(sector)); err != nil {
		slog.Warn("classification write-through seed failed", "symbol", symbol, "error", err)
	}
}
