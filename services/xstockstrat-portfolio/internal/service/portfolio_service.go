package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
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
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/middleware"
	"github.com/xstockstrat/portfolio/internal/repository"
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

	ledgerConn, err := grpc.NewClient(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	mdConn, err := grpc.NewClient(cfg.MarketDataEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial marketdata: %w", err)
	}
	notifyConn, err := grpc.NewClient(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
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
			return fmt.Errorf("recv: %w", err)
		}
		s.processOrderFill(ctx, event)
	}
}

// orderFillPayload is the expected shape of the order.filled / order.partially_filled event payload.
type orderFillPayload struct {
	UserID    string  `json:"user_id"`
	Symbol    string  `json:"symbol"`
	Qty       float64 `json:"qty"`        // set by order.filled (total); zero for order.partially_filled
	FilledQty float64 `json:"filled_qty"` // set by order.partially_filled (cumulative); zero for order.filled
	FillPrice float64 `json:"fill_price"`
	Mode      string  `json:"trading_mode"` // "TRADING_MODE_PAPER" | "TRADING_MODE_LIVE"
	AccountId string  `json:"account_id"`
	OrderID   string  `json:"order_id"`
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

// enrichPositions fills CurrentPrice / MarketValue / UnrealizedPnl on each position
// from the latest market-data quote. A failed lookup or an empty (zero) quote leaves
// the position's price fields at zero, but is logged so the gap is diagnosable rather
// than silently masked (otherwise positions render at $0.00 with no explanation).
func (s *PortfolioService) enrichPositions(ctx context.Context, positions []*portfoliov1.Position) {
	for _, p := range positions {
		quote, err := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if err != nil {
			slog.Warn("latest quote unavailable for position", "symbol", p.Symbol, "error", err)
			continue
		}
		price := (quote.AskPrice + quote.BidPrice) / 2
		if price <= 0 {
			slog.Warn("latest quote has no usable price", "symbol", p.Symbol, "ask", quote.AskPrice, "bid", quote.BidPrice)
			continue
		}
		enrichPosition(p, quote.AskPrice, quote.BidPrice)
	}
}

// enrichPosition fills current price / market value / unrealized P&L on p from a quote's
// ask/bid, using the mid price (Ask+Bid)/2. UnrealizedPnlPct is guarded against zero cost basis.
func enrichPosition(p *portfoliov1.Position, askPrice, bidPrice float64) {
	price := (askPrice + bidPrice) / 2
	p.CurrentPrice = price
	p.MarketValue = price * p.Qty
	p.UnrealizedPnl = p.MarketValue - p.CostBasis
	if p.CostBasis > 0 {
		p.UnrealizedPnlPct = p.UnrealizedPnl / p.CostBasis
	}
}

// sideOf derives a PositionSide from a signed quantity (qty > 0 long, qty < 0 short).
func sideOf(qty float64) portfoliov1.PositionSide {
	switch {
	case qty > 0:
		return portfoliov1.PositionSide_POSITION_SIDE_LONG
	case qty < 0:
		return portfoliov1.PositionSide_POSITION_SIDE_SHORT
	default:
		return portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED
	}
}

// GetPortfolio aggregates all open positions with live prices.
func (s *PortfolioService) GetPortfolio(ctx context.Context, req *portfoliov1.GetPortfolioRequest) (*portfoliov1.Portfolio, error) {
	positions, _, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, 500, "", req.GetAccountId(), "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
	if err != nil {
		return nil, err
	}
	s.enrichPositions(ctx, positions)

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
	s.enrichPositions(ctx, []*portfoliov1.Position{p})
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
	positions, nextToken, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, pageSize, pageToken, req.GetAccountId(), req.Symbol, req.Side)
	if err != nil {
		return nil, err
	}
	// Enrich each position with live price / market value / unrealized P&L (repo ListPositions
	// returns these unset; the UI winners/losers P&L filter and detail view need them).
	for _, p := range positions {
		quote, qErr := s.marketdata.GetLatestQuote(ctx, &marketdatav1.GetLatestQuoteRequest{Symbol: p.Symbol})
		if qErr == nil {
			enrichPosition(p, quote.AskPrice, quote.BidPrice)
		}
	}
	return &portfoliov1.ListPositionsResponse{
		Positions: positions,
		Page:      &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
}

// GetPnL computes realized + unrealized P&L for a user over a time range.
func (s *PortfolioService) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
	positions, _, err := s.repo.ListPositions(ctx, req.UserId, req.TradingMode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
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

	var realized float64
	accs := make(map[string]*fillAccumulator)
	filledOrderIDs := make(map[string]bool)
	latestPartials := make(map[string]orderFillPayload)

	applyFill := func(qty, fillPrice float64, symbol string) {
		acc := accs[symbol]
		if acc == nil {
			acc = &fillAccumulator{}
			accs[symbol] = acc
		}
		sameDirection := acc.qty == 0 || (qty > 0) == (acc.qty > 0)
		if sameDirection {
			acc.qty += qty
			acc.costBasis += qty * fillPrice
		} else {
			avgEntry := acc.costBasis / acc.qty
			closeQty := qty
			if math.Abs(closeQty) > math.Abs(acc.qty) {
				closeQty = -acc.qty
			}
			realized += (-closeQty) * (fillPrice - avgEntry)
			oldQty := acc.qty
			acc.qty += closeQty
			if math.Abs(acc.qty) < 1e-9 {
				acc.qty = 0
				acc.costBasis = 0
			} else {
				acc.costBasis = acc.costBasis * acc.qty / oldQty
			}
			remainder := qty - closeQty
			if math.Abs(remainder) > 1e-9 {
				acc.qty += remainder
				acc.costBasis += remainder * fillPrice
			}
		}
	}

	// Pass 1 — query order.filled events; accumulate realized P&L and track completed order IDs.
	var pageToken string
	for {
		resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
			EventType:     "order.filled",
			SourceService: "trading",
			Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
		})
		if err != nil {
			slog.Warn("GetPnL: QueryEvents (filled) failed", "error", err)
			break
		}
		for _, ev := range resp.GetEvents() {
			if ev.Payload == nil {
				continue
			}
			raw, err := ev.Payload.MarshalJSON()
			if err != nil {
				continue
			}
			var fill orderFillPayload
			if err := json.Unmarshal(raw, &fill); err != nil {
				continue
			}
			if fill.UserID != req.UserId {
				continue
			}
			if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
				fillMode := commonv1.TradingMode_TRADING_MODE_PAPER
				if fill.Mode == "TRADING_MODE_LIVE" {
					fillMode = commonv1.TradingMode_TRADING_MODE_LIVE
				}
				if fillMode != req.TradingMode {
					continue
				}
			}
			filledOrderIDs[fill.OrderID] = true
			applyFill(fill.Qty, fill.FillPrice, fill.Symbol)
		}
		if resp.GetPage().GetNextPageToken() == "" {
			break
		}
		pageToken = resp.GetPage().GetNextPageToken()
	}

	// Pass 2 — query order.partially_filled events; keep last per order ID (highest cumulative FilledQty).
	pageToken = ""
	for {
		resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
			EventType:     "order.partially_filled",
			SourceService: "trading",
			Page:          &commonv1.PageRequest{PageSize: 500, PageToken: pageToken},
		})
		if err != nil {
			slog.Warn("GetPnL: QueryEvents (partially_filled) failed", "error", err)
			break
		}
		for _, ev := range resp.GetEvents() {
			if ev.Payload == nil {
				continue
			}
			raw, err := ev.Payload.MarshalJSON()
			if err != nil {
				continue
			}
			var fill orderFillPayload
			if err := json.Unmarshal(raw, &fill); err != nil {
				continue
			}
			if fill.UserID != req.UserId {
				continue
			}
			if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
				fillMode := commonv1.TradingMode_TRADING_MODE_PAPER
				if fill.Mode == "TRADING_MODE_LIVE" {
					fillMode = commonv1.TradingMode_TRADING_MODE_LIVE
				}
				if fillMode != req.TradingMode {
					continue
				}
			}
			// Events arrive in recorded_at order; overwrite = keep last (highest cumulative FilledQty).
			latestPartials[fill.OrderID] = fill
		}
		if resp.GetPage().GetNextPageToken() == "" {
			break
		}
		pageToken = resp.GetPage().GetNextPageToken()
	}
	// Apply partial fills only for orders that never reached order.filled status.
	for orderID, fill := range latestPartials {
		if filledOrderIDs[orderID] {
			continue
		}
		applyFill(fill.FilledQty, fill.FillPrice, fill.Symbol)
	}

	return &portfoliov1.PnLResponse{
		RealizedPnl:   realized,
		UnrealizedPnl: unrealized,
		TotalPnl:      realized + unrealized,
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
	positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
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

	positions, _, err := s.repo.ListPositions(ctx, userID, mode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
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

// fillAccumulator tracks signed average-cost-basis state per symbol for realized P&L computation.
type fillAccumulator struct {
	qty       float64 // signed: positive = long, negative = short
	costBasis float64 // signed: qty × avg_entry_price
}

// positionSyncPayload is the expected shape of the account.positions.synced event payload.
type positionSyncPayload struct {
	AccountID   string `json:"account_id"`
	UserID      string `json:"user_id"`
	TradingMode string `json:"trading_mode"`
	Positions   []struct {
		Symbol  string  `json:"symbol"`
		Qty     float64 `json:"qty"`
		AvgCost float64 `json:"avg_cost"`
		// Broker mark-to-market valuation (zero when the broker did not report it, e.g.
		// legacy events emitted before these fields existed). When present these are
		// authoritative and used verbatim so the card reconciles with broker equity.
		CurrentPrice     float64 `json:"current_price"`
		MarketValue      float64 `json:"market_value"`
		UnrealizedPnl    float64 `json:"unrealized_pl"`
		UnrealizedPnlPct float64 `json:"unrealized_plpc"`
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
			return fmt.Errorf("recv: %w", err)
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

	// Store synced positions under the account owner's user_id so they reconcile
	// with order-fill positions and are visible to per-user portfolio queries.
	// Fall back to "default" for legacy events emitted before user_id was carried.
	userID := sync.UserID
	if userID == "" {
		userID = "default"
	}
	presentSymbols := make([]string, 0, len(sync.Positions))
	for _, p := range sync.Positions {
		val := repository.PositionValuation{
			CurrentPrice:     p.CurrentPrice,
			MarketValue:      p.MarketValue,
			UnrealizedPnl:    p.UnrealizedPnl,
			UnrealizedPnlPct: p.UnrealizedPnlPct,
		}
		if err := s.repo.UpsertPositionFromSync(ctx, userID, p.Symbol, sync.TradingMode, sync.AccountID, p.Qty, p.AvgCost, val); err != nil {
			slog.Warn("upsert position from sync failed", "symbol", p.Symbol, "error", err)
		}
		presentSymbols = append(presentSymbols, p.Symbol)
	}
	if err := s.repo.DeletePositionsNotInSync(ctx, sync.AccountID, userID, presentSymbols); err != nil {
		slog.Warn("delete positions not in sync failed", "account_id", sync.AccountID, "error", err)
	}
}

// balanceSyncPayload is the expected shape of the account.balance.synced event payload.
type balanceSyncPayload struct {
	AccountID   string  `json:"account_id"`
	UserID      string  `json:"user_id"`
	TradingMode string  `json:"trading_mode"`
	Cash        float64 `json:"cash"`
	BuyingPower float64 `json:"buying_power"`
	Equity      float64 `json:"equity"`
	LastEquity  float64 `json:"last_equity"`
}

// ConsumeBalanceSyncs subscribes to ledger StreamEvents filtered on "account.balance.synced"
// and stores the latest broker balance snapshot per account.
func (s *PortfolioService) ConsumeBalanceSyncs(ctx context.Context) {
	for {
		if err := s.streamBalanceSyncs(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			slog.Error("balance sync stream error, retrying", "error", err)
			time.Sleep(2 * time.Second)
		}
	}
}

func (s *PortfolioService) streamBalanceSyncs(ctx context.Context) error {
	stream, err := s.ledger.StreamEvents(ctx, &ledgerv1.StreamEventsRequest{
		EventType:    "account.balance.synced",
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
			return fmt.Errorf("recv: %w", err)
		}
		s.processBalanceSync(ctx, event)
	}
}

func (s *PortfolioService) processBalanceSync(ctx context.Context, event *ledgerv1.LedgerEvent) {
	if event.Payload == nil {
		return
	}
	raw, err := event.Payload.MarshalJSON()
	if err != nil {
		return
	}
	var bal balanceSyncPayload
	if err := json.Unmarshal(raw, &bal); err != nil {
		slog.Warn("parse balance sync payload", "error", err)
		return
	}
	if bal.AccountID == "" {
		return
	}
	userID := bal.UserID
	if userID == "" {
		userID = "default"
	}
	if err := s.repo.UpsertAccountBalance(ctx, bal.AccountID, userID, bal.TradingMode, bal.Cash, bal.BuyingPower, bal.Equity, bal.LastEquity); err != nil {
		slog.Warn("upsert account balance failed", "account_id", bal.AccountID, "error", err)
	}
}

// buildAccountPortfolio assembles a Portfolio for a single broker account: its
// positions (enriched with live prices) overlaid with the broker-synced balance
// snapshot. The broker is authoritative for cash, buying power, and total equity
// (cash + positions); day P&L is derived from equity vs. previous-close equity.
// When bal is nil, equity falls back to the summed position market value.
func (s *PortfolioService) buildAccountPortfolio(ctx context.Context, accountID string, bal *repository.AccountBalance) (*portfoliov1.Portfolio, error) {
	positions, err := s.repo.ListPositionsByAccount(ctx, accountID, "")
	if err != nil {
		return nil, err
	}
	// Positions synced from the broker carry its authoritative mark-to-market valuation
	// (current_price/market_value/unrealized_pnl), which reconciles with the broker equity
	// shown below. Only fall back to marketdata mid-quote enrichment for positions the broker
	// did not value — e.g. a fresh order-fill position not yet reconciled by the sync poller.
	var needEnrich []*portfoliov1.Position
	for _, p := range positions {
		if p.CurrentPrice <= 0 {
			needEnrich = append(needEnrich, p)
		}
	}
	s.enrichPositions(ctx, needEnrich)

	var positionsValue, unrealizedPnl float64
	for _, p := range positions {
		positionsValue += p.MarketValue
		unrealizedPnl += p.UnrealizedPnl
	}

	portfolio := &portfoliov1.Portfolio{
		PortfolioId: accountID,
		AccountId:   accountID,
		Equity:      positionsValue,
		TotalPnl:    unrealizedPnl,
		UpdatedAt:   timestamppb.Now(),
		Positions:   positions,
	}
	if bal != nil {
		portfolio.Cash = bal.Cash
		portfolio.BuyingPower = bal.BuyingPower
		portfolio.Equity = bal.Equity
		portfolio.DayPnl = bal.Equity - bal.LastEquity
		if bal.LastEquity > 0 {
			portfolio.DayPnlPct = portfolio.DayPnl / bal.LastEquity
		}
	}
	return portfolio, nil
}

// ListPortfolios returns a Portfolio per broker account. With a specific account_id
// it returns just that account; without one it aggregates every account owned by the
// requesting user (resolved from the propagated x-user-id header), so the "All
// Accounts" view sums real per-account equity instead of showing $0.00.
func (s *PortfolioService) ListPortfolios(ctx context.Context, req *portfoliov1.ListPortfoliosRequest) (*portfoliov1.ListPortfoliosResponse, error) {
	accountID := req.GetAccountId()
	if accountID != "" {
		bal, err := s.repo.GetAccountBalance(ctx, accountID)
		if err != nil {
			slog.Warn("ListPortfolios: GetAccountBalance failed", "account_id", accountID, "error", err)
		}
		portfolio, err := s.buildAccountPortfolio(ctx, accountID, bal)
		if err != nil {
			return nil, err
		}
		return &portfoliov1.ListPortfoliosResponse{
			Portfolios: []*portfoliov1.Portfolio{portfolio},
		}, nil
	}

	// All-accounts view: discover every account owned by the requesting user.
	userID := middleware.FromContext(ctx).UserID
	if userID == "" {
		return &portfoliov1.ListPortfoliosResponse{}, nil
	}
	accounts, err := s.repo.ListAccountBalancesByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	portfolios := make([]*portfoliov1.Portfolio, 0, len(accounts))
	for _, acct := range accounts {
		bal := acct.Balance
		portfolio, err := s.buildAccountPortfolio(ctx, acct.AccountID, &bal)
		if err != nil {
			slog.Warn("ListPortfolios: build account portfolio failed", "account_id", acct.AccountID, "error", err)
			continue
		}
		portfolios = append(portfolios, portfolio)
	}
	return &portfoliov1.ListPortfoliosResponse{Portfolios: portfolios}, nil
}
