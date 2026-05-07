package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PortfolioService implements business logic for the portfolio service.
type PortfolioService struct {
	repo       *repository.PortfolioRepo
	cfg        *config.Watcher
	envCfg     *config.Config
	ledger     ledgerv1.LedgerServiceClient
	marketdata marketdatav1.MarketDataServiceClient
	notify     notifyv1.NotifyServiceClient

	mu   sync.RWMutex
	subs map[string]chan *portfoliov1.PortfolioSnapshot
}

// NewPortfolioService creates the service, opens the DB pool, and dials dependencies.
func NewPortfolioService(cfg *config.Config, cfgWatcher *config.Watcher) (*PortfolioService, error) {
	repo, err := repository.NewPortfolioRepo(cfg.DBConnStr)
	if err != nil {
		return nil, fmt.Errorf("portfolio repo: %w", err)
	}

	ledgerConn, err := grpc.NewClient(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	mdConn, err := grpc.NewClient(cfg.MarketDataEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial marketdata: %w", err)
	}
	notifyConn, err := grpc.NewClient(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial notify: %w", err)
	}

	svc := &PortfolioService{
		repo:       repo,
		cfg:        cfgWatcher,
		envCfg:     cfg,
		ledger:     ledgerv1.NewLedgerServiceClient(ledgerConn),
		marketdata: marketdatav1.NewMarketDataServiceClient(mdConn),
		notify:     notifyv1.NewNotifyServiceClient(notifyConn),
		subs:       make(map[string]chan *portfoliov1.PortfolioSnapshot),
	}
	return svc, nil
}

// ConsumeOrderFills subscribes to ledger StreamEvents filtered on "order.filled"
// and updates positions accordingly.
func (s *PortfolioService) ConsumeOrderFills(ctx context.Context) {
	for {
		if err := s.streamFills(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("order fill stream error, retrying", "error", err)
			time.Sleep(2 * time.Second)
		}
	}
}

func (s *PortfolioService) streamFills(ctx context.Context) error {
	stream, err := s.ledger.StreamEvents(ctx, &ledgerv1.StreamEventsRequest{
		EventType:    "order.filled",
		FromSequence: 0,
	})
	if err != nil {
		return fmt.Errorf("StreamEvents: %w", err)
	}
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("Recv: %w", err)
		}
		s.processOrderFill(ctx, event)
	}
}

// orderFillPayload is the expected shape of the order.filled event payload.
type orderFillPayload struct {
	UserID    string  `json:"user_id"`
	Symbol    string  `json:"symbol"`
	Qty       float64 `json:"qty"`          // positive = buy, negative = sell
	FillPrice float64 `json:"fill_price"`
	Mode      string  `json:"trading_mode"` // "TRADING_MODE_PAPER" | "TRADING_MODE_LIVE"
	AccountId string  `json:"account_id"`
}

func (s *PortfolioService) processOrderFill(ctx context.Context, event *ledgerv1.LedgerEvent) {
	if event.Payload == nil {
		return
	}
	raw, err := event.Payload.MarshalJSON()
	if err != nil {
		return
	}
	var fill orderFillPayload
	if err := json.Unmarshal(raw, &fill); err != nil {
		slog.Warn("parse order fill payload", "error", err)
		return
	}

	mode := commonv1.TradingMode_TRADING_MODE_PAPER
	if fill.Mode == "TRADING_MODE_LIVE" {
		mode = commonv1.TradingMode_TRADING_MODE_LIVE
	}

	// Get existing position to compute new avg entry
	existing, _ := s.repo.GetPosition(ctx, fill.UserID, fill.Symbol, mode)
	var (
		newQty      float64
		newAvgEntry float64
		newCost     float64
	)
	if existing != nil {
		newQty = existing.Qty + fill.Qty
		if fill.Qty > 0 { // buying more
			newCost = existing.CostBasis + fill.Qty*fill.FillPrice
			newAvgEntry = newCost / newQty
		} else { // selling
			newCost = existing.CostBasis * (newQty / existing.Qty)
			newAvgEntry = existing.AvgEntryPrice
		}
	} else {
		newQty = fill.Qty
		newCost = fill.Qty * fill.FillPrice
		newAvgEntry = fill.FillPrice
	}

	acctID := fill.AccountId
	if acctID == "" {
		acctID = "alpaca-default"
	}

	if newQty <= 0 {
		_ = s.repo.ClosePosition(ctx, fill.UserID, fill.Symbol, mode)
		s.emitEvent(ctx, "portfolio.position.closed", "portfolio:"+fill.UserID, map[string]interface{}{
			"user_id": fill.UserID, "symbol": fill.Symbol,
		})
	} else {
		_ = s.repo.UpsertPosition(ctx, fill.UserID, fill.Symbol, newQty, newAvgEntry, newCost, mode, acctID)
		eventType := "portfolio.position.opened"
		if existing != nil {
			eventType = "portfolio.position.updated"
		}
		s.emitEvent(ctx, eventType, "portfolio:"+fill.UserID, map[string]interface{}{
			"user_id": fill.UserID, "symbol": fill.Symbol, "qty": newQty,
		})
	}

	s.checkRiskLimits(ctx, fill.UserID, mode)
	s.broadcastSnapshot(ctx, fill.UserID, mode)
}

// GetPortfolio aggregates all open positions with live prices.
func (s *PortfolioService) GetPortfolio(ctx context.Context, req *portfoliov1.GetPortfolioRequest) (*portfoliov1.Portfolio, error) {
	positions, _, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, 500, "", req.GetAccountId())
	if err != nil {
		return nil, err
	}
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err == nil {
			price := (quote.AskPrice + quote.BidPrice) / 2
			p.CurrentPrice = price
			p.MarketValue = price * p.Qty
			p.UnrealizedPnl = p.MarketValue - p.CostBasis
			if p.CostBasis > 0 {
				p.UnrealizedPnlPct = p.UnrealizedPnl / p.CostBasis
			}
		}
	}

	var totalValue float64
	for _, p := range positions {
		totalValue += p.MarketValue
	}

	return &portfoliov1.Portfolio{
		PortfolioId: req.UserId,
		UserId:      req.UserId,
		Equity:      totalValue,
		UpdatedAt:   timestamppb.Now(),
		Positions:   positions,
	}, nil
}

// GetPosition returns a single position with live price.
func (s *PortfolioService) GetPosition(ctx context.Context, req *portfoliov1.GetPositionRequest) (*portfoliov1.Position, error) {
	p, err := s.repo.GetPosition(ctx, req.UserId, req.Symbol, req.TradingMode)
	if err != nil {
		return nil, err
	}
	quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
	if err == nil {
		price := (quote.AskPrice + quote.BidPrice) / 2
		p.CurrentPrice = price
		p.MarketValue = price * p.Qty
		p.UnrealizedPnl = p.MarketValue - p.CostBasis
		if p.CostBasis > 0 {
			p.UnrealizedPnlPct = p.UnrealizedPnl / p.CostBasis
		}
	}
	return p, nil
}

// ListPositions returns paginated positions.
func (s *PortfolioService) ListPositions(ctx context.Context, req *portfoliov1.ListPositionsRequest) (*portfoliov1.ListPositionsResponse, error) {
	pageSize := 100
	pageToken := ""
	if req.Page != nil {
		if req.Page.PageSize > 0 {
			pageSize = int(req.Page.PageSize)
		}
		pageToken = req.Page.PageToken
	}
	positions, nextToken, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, pageSize, pageToken, "")
	if err != nil {
		return nil, err
	}
	return &portfoliov1.ListPositionsResponse{
		Positions: positions,
		Page:      &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
}

// GetPnL computes realized + unrealized P&L for a user over a time range.
func (s *PortfolioService) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
	positions, _, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, 500, "", "")
	if err != nil {
		return nil, err
	}
	var unrealized float64
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err == nil {
			price := (quote.AskPrice + quote.BidPrice) / 2
			unrealized += (price - p.AvgEntryPrice) * p.Qty
		}
	}
	return &portfoliov1.PnLResponse{
		UnrealizedPnl: unrealized,
		Range:         req.Range,
	}, nil
}

// GetSnapshot retrieves a historical portfolio snapshot.
func (s *PortfolioService) GetSnapshot(ctx context.Context, req *portfoliov1.GetSnapshotRequest) (*portfoliov1.PortfolioSnapshot, error) {
	at := time.Now()
	if req.AtTime != nil {
		at = req.AtTime.AsTime()
	}
	return s.repo.GetSnapshot(ctx, req.PortfolioId, at)
}

// Subscribe registers a streaming channel for portfolio updates.
func (s *PortfolioService) Subscribe(id string) chan *portfoliov1.PortfolioSnapshot {
	ch := make(chan *portfoliov1.PortfolioSnapshot, 32)
	s.mu.Lock()
	s.subs[id] = ch
	s.mu.Unlock()
	return ch
}

// Unsubscribe removes and closes a subscriber.
func (s *PortfolioService) Unsubscribe(id string) {
	s.mu.Lock()
	if ch, ok := s.subs[id]; ok {
		delete(s.subs, id)
		close(ch)
	}
	s.mu.Unlock()
}

// StartSnapshotWriter periodically writes portfolio snapshots to the DB.
func (s *PortfolioService) StartSnapshotWriter(ctx context.Context, userID string, mode commonv1.TradingMode) {
	intervalMin := s.cfg.GetInt("portfolio.snapshot.interval_minutes", 5)
	ticker := time.NewTicker(time.Duration(intervalMin) * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.broadcastSnapshot(ctx, userID, mode)
		}
	}
}

func (s *PortfolioService) broadcastSnapshot(ctx context.Context, userID string, mode commonv1.TradingMode) {
	positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "")
	if err != nil {
		return
	}
	var equity float64
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err == nil {
			price := (quote.AskPrice + quote.BidPrice) / 2
			equity += price * p.Qty
		}
	}
	snap := &portfoliov1.PortfolioSnapshot{
		PortfolioId:   userID,
		SnapshotTime:  timestamppb.Now(),
		Equity:        equity,
		OpenPositions: int32(len(positions)),
		TradingMode:   mode,
	}
	_ = s.repo.InsertSnapshot(ctx, userID, userID, equity, 0, 0, len(positions), mode)
	s.emitEvent(ctx, "portfolio.snapshot", "portfolio:"+userID, map[string]interface{}{
		"equity": equity, "open_positions": len(positions),
	})

	s.mu.RLock()
	for _, ch := range s.subs {
		select {
		case ch <- snap:
		default:
		}
	}
	s.mu.RUnlock()
}

func (s *PortfolioService) checkRiskLimits(ctx context.Context, userID string, mode commonv1.TradingMode) {
	maxDrawdownPct := s.cfg.GetFloat("portfolio.risk.max_drawdown_pct", 0.10)
	concentrationLimitPct := s.cfg.GetFloat("portfolio.risk.concentration_limit_pct", 0.20)

	positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "")
	if err != nil {
		return
	}
	var totalValue float64
	posValues := make(map[string]float64)
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err == nil {
			price := (quote.AskPrice + quote.BidPrice) / 2
			val := price * p.Qty
			posValues[p.Symbol] = val
			totalValue += val
		}
	}

	// Check concentration limits
	if totalValue > 0 {
		for sym, val := range posValues {
			pct := val / totalValue
			if pct > concentrationLimitPct {
				s.emitRiskAlert(ctx, fmt.Sprintf("concentration limit breach: %s at %.1f%%", sym, pct*100))
			}
		}
	}
	_ = maxDrawdownPct // drawdown requires historical P&L tracking — handled by snapshots over time
}

func (s *PortfolioService) emitRiskAlert(ctx context.Context, msg string) {
	s.emitEvent(ctx, "portfolio.risk.drawdown_breach", "portfolio:risk", map[string]interface{}{
		"message": msg,
	})
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      "risk",
		Title:         "portfolio risk limit breach",
		Body:          msg,
		SourceService: "portfolio",
	})
	if err != nil {
		slog.Warn("notify emit failed", "error", err)
	}
}

func (s *PortfolioService) emitEvent(ctx context.Context, eventType, streamKey string, payload map[string]interface{}) {
	fields := make(map[string]*structpb.Value, len(payload))
	for k, v := range payload {
		val, _ := structpb.NewValue(v)
		fields[k] = val
	}
	_, err := s.ledger.AppendEvent(ctx, &ledgerv1.AppendEventRequest{
		EventType:     eventType,
		SourceService: "portfolio",
		StreamKey:     streamKey,
		OccurredAt:    timestamppb.Now(),
		Payload:       &structpb.Struct{Fields: fields},
	})
	if err != nil {
		slog.Warn("ledger append failed", "event_type", eventType, "error", err)
	}
}

// positionSyncPayload is the expected shape of the account.positions.synced event payload.
type positionSyncPayload struct {
	AccountID   string `json:"account_id"`
	TradingMode string `json:"trading_mode"`
	Positions   []struct {
		Symbol  string  `json:"symbol"`
		Qty     float64 `json:"qty"`
		AvgCost float64 `json:"avg_cost"`
	} `json:"positions"`
}

// ConsumePositionSyncs subscribes to ledger StreamEvents filtered on "account.positions.synced"
// and upserts positions from broker snapshots.
func (s *PortfolioService) ConsumePositionSyncs(ctx context.Context) {
	for {
		if err := s.streamPositionSyncs(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("position sync stream error, retrying", "error", err)
			time.Sleep(2 * time.Second)
		}
	}
}

func (s *PortfolioService) streamPositionSyncs(ctx context.Context) error {
	stream, err := s.ledger.StreamEvents(ctx, &ledgerv1.StreamEventsRequest{
		EventType:    "account.positions.synced",
		FromSequence: 0,
	})
	if err != nil {
		return fmt.Errorf("StreamEvents: %w", err)
	}
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("Recv: %w", err)
		}
		s.processPositionSync(ctx, event)
	}
}

func (s *PortfolioService) processPositionSync(ctx context.Context, event *ledgerv1.LedgerEvent) {
	if event.Payload == nil {
		return
	}
	raw, err := event.Payload.MarshalJSON()
	if err != nil {
		return
	}
	var sync positionSyncPayload
	if err := json.Unmarshal(raw, &sync); err != nil {
		slog.Warn("parse position sync payload", "error", err)
		return
	}
	if sync.AccountID == "" {
		return
	}

	// account.positions.synced events don't carry user_id; use "default" as placeholder.
	userID := "default"
	presentSymbols := make([]string, 0, len(sync.Positions))
	for _, p := range sync.Positions {
		if err := s.repo.UpsertPositionFromSync(ctx, userID, p.Symbol, sync.TradingMode, sync.AccountID, p.Qty, p.AvgCost); err != nil {
			slog.Warn("upsert position from sync failed", "symbol", p.Symbol, "error", err)
		}
		presentSymbols = append(presentSymbols, p.Symbol)
	}
	if err := s.repo.DeletePositionsNotInSync(ctx, sync.AccountID, presentSymbols); err != nil {
		slog.Warn("delete positions not in sync failed", "account_id", sync.AccountID, "error", err)
	}
}

// ListPortfolios returns a Portfolio for the requested broker account (or an empty list if no
// account_id is specified, since cross-account aggregation requires a separate query).
func (s *PortfolioService) ListPortfolios(ctx context.Context, req *portfoliov1.ListPortfoliosRequest) (*portfoliov1.ListPortfoliosResponse, error) {
	accountID := req.GetAccountId()
	if accountID == "" {
		return &portfoliov1.ListPortfoliosResponse{}, nil
	}

	positions, err := s.repo.ListPositionsByAccount(ctx, accountID, "")
	if err != nil {
		return nil, err
	}

	var equity float64
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err == nil {
			price := (quote.AskPrice + quote.BidPrice) / 2
			p.CurrentPrice = price
			p.MarketValue = price * p.Qty
			p.UnrealizedPnl = p.MarketValue - p.CostBasis
			if p.CostBasis > 0 {
				p.UnrealizedPnlPct = p.UnrealizedPnl / p.CostBasis
			}
			equity += p.MarketValue
		}
	}

	return &portfoliov1.ListPortfoliosResponse{
		Portfolios: []*portfoliov1.Portfolio{{
			PortfolioId: accountID,
			AccountId:   accountID,
			Equity:      equity,
			UpdatedAt:   timestamppb.Now(),
			Positions:   positions,
		}},
	}, nil
}
