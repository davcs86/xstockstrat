package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/contracts/pnl"
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

	// Watchlists — held behind interfaces so cap/ownership rules can be unit-tested with stubs.
	watchlists WatchlistStore
	wlCfg      watchlistConfig

	mu   sync.RWMutex
	subs map[string]chan *portfoliov1.PortfolioSnapshot

	// stops holds resting-stop prices learned from ledger order events, in-memory and rebuilt on boot
	// (HydrateStops) — deliberately no portfolio→trading edge, which would create a trading↔portfolio cycle.
	stops *stopStore
}

// stopNearThresholdPct — a position whose stop sits within this fraction of current price is
// flagged POSITION_RISK_FLAG_STOP_NEAR.
const stopNearThresholdPct = 0.03

// stopKey identifies a resting stop by (user, symbol, trading mode).
type stopKey struct {
	user   string
	symbol string
	mode   commonv1.TradingMode
}

// stopStore is a concurrency-safe in-memory map of learned resting-stop prices.
type stopStore struct {
	mu    sync.RWMutex
	stops map[stopKey]float64
}

func newStopStore() *stopStore {
	return &stopStore{stops: make(map[stopKey]float64)}
}

func (st *stopStore) set(k stopKey, price float64) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if price > 0 {
		st.stops[k] = price
	} else {
		delete(st.stops, k)
	}
}

func (st *stopStore) get(k stopKey) (float64, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	p, ok := st.stops[k]
	return p, ok
}

// clientKeepAlive pings idle inter-service connections so a silently-dropped link (e.g. an idle
// ledger connection the server GOAWAYs) is detected and re-established before the next call.
var clientKeepAlive = grpc.WithKeepaliveParams(keepalive.ClientParameters{
	Time:                30 * time.Second,
	Timeout:             10 * time.Second,
	PermitWithoutStream: true,
})

func NewPortfolioService(cfg *config.Config, cfgWatcher *config.Watcher) (*PortfolioService, error) {
	repo, err := repository.NewPortfolioRepo(cfg.DBConnStr)
	if err != nil {
		return nil, fmt.Errorf("portfolio repo: %w", err)
	}

	ledgerConn, err := grpc.NewClient(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	mdConn, err := grpc.NewClient(cfg.MarketDataEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial marketdata: %w", err)
	}
	notifyConn, err := grpc.NewClient(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
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
		// Watchlists reuse the single portfolio pgxpool (no second pool — budget stays 2).
		watchlists: repository.NewWatchlistRepo(repo.Pool()),
		wlCfg:      cfgWatcher,
		subs:       make(map[string]chan *portfoliov1.PortfolioSnapshot),
		stops:      newStopStore(),
	}
	return svc, nil
}

// ConsumeOrderFills subscribes to ledger StreamEvents filtered on "order.filled"
// and updates positions accordingly.
func (s *PortfolioService) ConsumeOrderFills(ctx context.Context) {
	s.consumeEventStream(ctx, "order fill", "order.filled", s.processOrderFill)
}

// consumeEventStream dispatches a filtered ledger StreamEvents to handle, reconnecting on disconnect
// and resuming from lastSeq+1 so a recycled stream neither double-counts nor drops events.
func (s *PortfolioService) consumeEventStream(ctx context.Context, name, eventType string, handle func(context.Context, *ledgerv1.LedgerEvent)) {
	var lastSeq int64
	for {
		next, err := s.streamEventsFrom(ctx, eventType, lastSeq, handle)
		lastSeq = next
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if isGracefulStreamClose(err) {
				slog.Info(name+" stream disconnected, reconnecting", "resume_from_sequence", lastSeq+1)
			} else {
				slog.Error(name+" stream error, retrying", "error", err)
			}
			time.Sleep(2 * time.Second)
		}
	}
}

// streamEventsFrom opens one StreamEvents call and returns the highest sequence processed.
// lastSeq == 0 replays full history; lastSeq > 0 resumes from lastSeq+1.
func (s *PortfolioService) streamEventsFrom(ctx context.Context, eventType string, lastSeq int64, handle func(context.Context, *ledgerv1.LedgerEvent)) (int64, error) {
	fromSeq := int64(0)
	if lastSeq > 0 {
		fromSeq = lastSeq + 1
	}
	stream, err := s.ledger.StreamEvents(ctx, &ledgerv1.StreamEventsRequest{
		EventType:    eventType,
		FromSequence: fromSeq,
	})
	if err != nil {
		return lastSeq, fmt.Errorf("StreamEvents: %w", err)
	}
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			return lastSeq, nil
		}
		if err != nil {
			return lastSeq, fmt.Errorf("recv: %w", err)
		}
		handle(ctx, event)
		if event.Sequence > lastSeq {
			lastSeq = event.Sequence
		}
	}
}

// isGracefulStreamClose reports whether a stream error is a benign disconnect (GOAWAY / transport
// recycle as codes.Unavailable) rather than a real failure worth alerting on.
func isGracefulStreamClose(err error) bool {
	if st, ok := status.FromError(err); ok {
		return st.Code() == codes.Unavailable
	}
	return false
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
	// StopPrice is carried by a stop/stop-limit order event; zero on plain market/limit fills.
	// Learned into the in-memory stop store for the Exposure surface.
	StopPrice float64 `json:"stop_price"`
	// Fees is the per-fill broker fee; absent key ⇒ 0 (net == gross). Accumulated into fees_accum
	// and emitted as fees_total on the close event.
	Fees float64 `json:"fees"`
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

	if fill.StopPrice > 0 && s.stops != nil {
		s.stops.set(stopKey{user: fill.UserID, symbol: fill.Symbol, mode: mode}, fill.StopPrice)
	}

	// Fetch the existing position scoped to the fill's account: without account scoping a multi-account
	// user's fill would compute the new avg entry from the wrong account's most-recent position.
	existing, _ := s.repo.GetPosition(ctx, fill.UserID, fill.Symbol, mode, fill.AccountId)
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

	// Realized P&L this fill contributed by reducing the position — 0 when opening/adding or when no
	// prior position exists (a redelivered post-close sell must not nil-deref).
	var delta float64
	if existing != nil {
		delta = pnl.RealizedDelta(existing.Qty, existing.CostBasis, fill.Qty, fill.FillPrice)
	}

	if newQty <= 0 {
		// Row is about to be deleted: the sealed realized goes into the emitted payload only, never
		// persisted. Read prior accum + this closing delta.
		var sealed float64
		// realized_pnl stays GROSS/authoritative; net = realized_pnl - fees_total downstream.
		var feesSealed float64
		if existing != nil {
			priorAccum, _ := s.repo.GetRealizedAccum(ctx, fill.UserID, fill.Symbol, mode, acctID)
			sealed = priorAccum + delta
			priorFees, _ := s.repo.GetFeesAccum(ctx, fill.UserID, fill.Symbol, mode, acctID)
			feesSealed = priorFees + fill.Fees
		}
		_ = s.repo.ClosePosition(ctx, fill.UserID, fill.Symbol, mode, acctID)
		s.emitEvent(ctx, "portfolio.position.closed", "portfolio:"+fill.UserID,
			closedPositionPayload(fill.UserID, fill.Symbol, acctID, mode.String(), sealed, feesSealed, existing))
	} else {
		_ = s.repo.UpsertPosition(ctx, fill.UserID, fill.Symbol, newQty, newAvgEntry, newCost, mode, acctID, delta, fill.Fees)
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

// closedPositionPayload builds the portfolio.position.closed emit payload. The base keys are the
// producer contract — never dropped/renamed (C-16); cost_basis + opened_at are added only when existing != nil.
func closedPositionPayload(userID, symbol, acctID, mode string, sealed, feesSealed float64, existing *portfoliov1.Position) map[string]interface{} {
	payload := map[string]interface{}{
		"user_id": userID, "symbol": symbol, "account_id": acctID,
		"trading_mode": mode, "realized_pnl": sealed,
		"fees_total": feesSealed,
	}
	if existing != nil {
		payload["cost_basis"] = existing.CostBasis
		payload["opened_at"] = existing.OpenedAt.AsTime().Format(time.RFC3339)
	}
	return payload
}

func (s *PortfolioService) enrichPositions(ctx context.Context, positions []*portfoliov1.Position) {
	for _, p := range positions {
		if p.CurrentPrice > 0 {
			continue
		}
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
	s.enrichRisk(ctx, positions)
}

// enrichRisk fills risk/factor fields from the learned resting stop + operator factor map, computed
// on read off the broker-authoritative CurrentPrice. No DB access.
func (s *PortfolioService) enrichRisk(ctx context.Context, positions []*portfoliov1.Position) {
	userID := middleware.FromContext(ctx).UserID
	var factorMap map[string]string
	if s.cfg != nil {
		factorMap = s.cfg.FactorMap()
	}
	for _, p := range positions {
		enrichPositionRisk(p, userID, factorMap, s.stops)
	}
}

// enrichPositionRisk sets the factor + stop-derived risk fields on one position (pure). An empty/absent
// factor map leaves Factor "" (the UI groups those as "Unclassified").
func enrichPositionRisk(p *portfoliov1.Position, userID string, factorMap map[string]string, stops *stopStore) {
	if f, ok := factorMap[p.Symbol]; ok {
		p.Factor = f
	}
	if stops == nil {
		return
	}
	if stop, ok := stops.get(stopKey{user: userID, symbol: p.Symbol, mode: p.TradingMode}); ok {
		applyStopRisk(p, stop)
	}
}

// applyStopRisk sets stop-derived fields from a resting stop price (pure). stop_distance_pct and
// risk_at_stop both come off CurrentPrice — the broker-authoritative value.
func applyStopRisk(p *portfoliov1.Position, stop float64) {
	if stop <= 0 || p.CurrentPrice <= 0 {
		return
	}
	p.StopPrice = stop
	p.StopDistancePct = (p.CurrentPrice - stop) / p.CurrentPrice
	p.RiskAtStop = p.Qty * (p.CurrentPrice - stop)
	p.ExitRule = fmt.Sprintf("Stop @ $%.2f", stop)
	if p.StopDistancePct >= 0 && p.StopDistancePct <= stopNearThresholdPct {
		p.Flag = portfoliov1.PositionRiskFlag_POSITION_RISK_FLAG_STOP_NEAR
	}
}

// HydrateStops rebuilds the in-memory stop store at boot by replaying ledger order events —
// best-effort: a ledger failure leaves the store empty rather than blocking startup.
func (s *PortfolioService) HydrateStops(ctx context.Context) {
	if s.stops == nil {
		return
	}
	resp, err := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{EventType: "order.filled"})
	if err != nil {
		slog.Warn("HydrateStops: QueryEvents failed", "error", err)
		return
	}
	n := 0
	for _, event := range resp.Events {
		if event.Payload == nil {
			continue
		}
		raw, err := event.Payload.MarshalJSON()
		if err != nil {
			continue
		}
		var fill orderFillPayload
		if err := json.Unmarshal(raw, &fill); err != nil {
			continue
		}
		if fill.StopPrice <= 0 {
			continue
		}
		mode := commonv1.TradingMode_TRADING_MODE_PAPER
		if fill.Mode == "TRADING_MODE_LIVE" {
			mode = commonv1.TradingMode_TRADING_MODE_LIVE
		}
		s.stops.set(stopKey{user: fill.UserID, symbol: fill.Symbol, mode: mode}, fill.StopPrice)
		n++
	}
	slog.Info("HydrateStops: replayed resting stops from ledger", "count", n)
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
	// Caller identity comes from the trusted x-user-id header, never the deprecated request-body user_id.
	userID := middleware.FromContext(ctx).UserID
	positions, _, err := s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", req.GetAccountId(), "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
	if err != nil {
		return nil, err
	}
	s.enrichPositions(ctx, positions)

	var totalValue float64
	for _, p := range positions {
		totalValue += p.MarketValue
	}

	portfolio := &portfoliov1.Portfolio{
		PortfolioId: userID,
		UserId:      userID,
		Equity:      totalValue,
		UpdatedAt:   timestamppb.Now(),
		Positions:   positions,
		AccountId:   req.GetAccountId(),
	}
	// Offline-account realized P&L set with proto3 presence so an offline $0 differs from a broker unset.
	// Populated on BOTH read paths (here + buildAccountPortfolio) for parity.
	if v, ok, err := s.repo.GetOfflineRealized(ctx, req.GetAccountId()); err == nil && ok {
		portfolio.RealizedPnl = proto.Float64(v)
	}
	return portfolio, nil
}

// GetPosition returns a single position with live price.
func (s *PortfolioService) GetPosition(ctx context.Context, req *portfoliov1.GetPositionRequest) (*portfoliov1.Position, error) {
	userID := middleware.FromContext(ctx).UserID
	p, err := s.repo.GetPosition(ctx, userID, req.Symbol, req.TradingMode, req.GetAccountId())
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
	userID := middleware.FromContext(ctx).UserID
	positions, nextToken, err := s.repo.ListPositions(ctx, userID, req.TradingMode, pageSize, pageToken, req.GetAccountId(), req.Symbol, req.Side)
	if err != nil {
		return nil, err
	}
	// Preserve the broker's valuation for positions it valued; fall back to marketdata mid-quote
	// enrichment only for positions the broker did not value (CurrentPrice <= 0).
	s.enrichPositions(ctx, positions)
	return &portfoliov1.ListPositionsResponse{
		Positions: positions,
		Page:      &commonv1.PageResponse{NextPageToken: nextToken},
	}, nil
}

// GetPnL computes realized + unrealized P&L over a time range. Realized uses the shared pnl package
// (the ONE realized-P&L implementation) — no second formula lives here (the feature-056 dual-source fix).
func (s *PortfolioService) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
	userID := middleware.FromContext(ctx).UserID
	positions, _, err := s.repo.ListPositions(ctx, userID, req.TradingMode, 500, "", "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
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

	// Collect fills in application order and fold once through the shared pnl package. Batching the fold
	// is behavior-identical to the former incremental applyFill (no state read between passes).
	var fills []pnl.Fill
	filledOrderIDs := make(map[string]bool)
	latestPartials := make(map[string]orderFillPayload)

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
			if fill.UserID != userID {
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
			fills = append(fills, pnl.Fill{Symbol: fill.Symbol, Qty: fill.Qty, Price: fill.FillPrice})
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
			if fill.UserID != userID {
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
		fills = append(fills, pnl.Fill{Symbol: fill.Symbol, Qty: fill.FilledQty, Price: fill.FillPrice})
	}

	realized := pnl.Fold(fills).Realized

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

// evaluateDrawdowns returns a per-account breach message for each account whose peak-to-current
// drawdown exceeds limit. peak_equity == 0 (no history) is skipped — no divide-by-zero.
func evaluateDrawdowns(rows []repository.AccountDrawdown, limit float64) []string {
	var msgs []string
	for _, d := range rows {
		if d.PeakEquity <= 0 {
			continue
		}
		dd := (d.PeakEquity - d.Equity) / d.PeakEquity
		if dd > limit {
			msgs = append(msgs, fmt.Sprintf(
				"drawdown limit breach: account %s at %.1f%% (peak %.2f, current %.2f)",
				d.AccountID, dd*100, d.PeakEquity, d.Equity))
		}
	}
	return msgs
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
	// Per-account drawdown: broker-authoritative equity vs persisted peak_equity HWM (feature 172).
	drawdowns, err := s.repo.GetAccountDrawdowns(ctx, userID, mode.String())
	if err == nil {
		for _, msg := range evaluateDrawdowns(drawdowns, maxDrawdownPct) {
			s.emitRiskAlert(ctx, msg)
		}
	}
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
	req := &ledgerv1.AppendEventRequest{
		EventType:     eventType,
		SourceService: "portfolio",
		StreamKey:     streamKey,
		OccurredAt:    timestamppb.Now(),
		Payload:       &structpb.Struct{Fields: fields},
		// Stable per-emit dedup key, reused across the retries below so a retry after a committed-but-
		// unacked append returns the stored event instead of writing a duplicate.
		IdempotencyKey: uuid.NewString(),
	}

	// Retry transient codes.Unavailable (a ledger GOAWAY) so a deploy-time ledger bounce doesn't drop
	// audit events; the idempotency key above makes the retry safe against duplication.
	const maxAttempts = 4
	backoff := 100 * time.Millisecond
	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if _, err = s.ledger.AppendEvent(ctx, req); err == nil {
			return
		}
		if status.Code(err) != codes.Unavailable || attempt == maxAttempts {
			break
		}
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		backoff *= 2
	}
	slog.Warn("ledger append failed", "event_type", eventType, "error", err)
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
		// Provenance: source is the PositionSource enum integer; as_of is the baseline snapshot
		// effective date (RFC3339, or empty for ORDERS-only positions).
		Source int    `json:"source"`
		AsOf   string `json:"as_of"`
		// Broker mark-to-market valuation; zero when not reported (e.g. legacy events). When present
		// these are authoritative and used verbatim so the card reconciles with broker equity.
		CurrentPrice     float64 `json:"current_price"`
		MarketValue      float64 `json:"market_value"`
		UnrealizedPnl    float64 `json:"unrealized_pl"`
		UnrealizedPnlPct float64 `json:"unrealized_plpc"`
		// Broker intraday (today's) P&L — change since the previous close. Distinct from
		// UnrealizedPnl (total since entry); zero when the broker did not report it.
		DayPnl    float64 `json:"day_pnl"`
		DayPnlPct float64 `json:"day_pnl_pct"`
	} `json:"positions"`
	// RealizedPnl is the account-grain cumulative realized P&L, set ONLY by an offline ConfirmOrder
	// recompute; a broker sync never carries it (nil) — the pointer's presence marks offline/broker.
	RealizedPnl *float64 `json:"realized_pnl"`
}

// ConsumePositionSyncs subscribes to ledger StreamEvents filtered on "account.positions.synced"
// and upserts positions from broker snapshots.
func (s *PortfolioService) ConsumePositionSyncs(ctx context.Context) {
	s.consumeEventStream(ctx, "position sync", "account.positions.synced", s.processPositionSync)
}

// accountDeregisteredPayload is the shape of trading's account.deregistered event.
type accountDeregisteredPayload struct {
	AccountID string `json:"account_id"`
	UserID    string `json:"user_id"`
}

// ConsumeAccountDeregistrations purges an offline account's positions + realized P&L on
// account.deregistered — no broker sync reconciles an offline account away, so the purge is event-driven.
func (s *PortfolioService) ConsumeAccountDeregistrations(ctx context.Context) {
	s.consumeEventStream(ctx, "account deregistration", "account.deregistered", s.processAccountDeregistered)
}

func (s *PortfolioService) processAccountDeregistered(ctx context.Context, event *ledgerv1.LedgerEvent) {
	if event.Payload == nil {
		return
	}
	raw, err := event.Payload.MarshalJSON()
	if err != nil {
		return
	}
	var payload accountDeregisteredPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		slog.Warn("parse account deregistered payload", "error", err)
		return
	}
	if payload.AccountID == "" {
		return
	}
	userID := payload.UserID
	if userID == "" {
		userID = "default"
	}
	// Purge all positions for the account (empty present-set deletes every row) and its realized row.
	if err := s.repo.DeletePositionsNotInSync(ctx, payload.AccountID, userID, []string{}); err != nil {
		slog.Warn("deregister: delete positions failed", "account_id", payload.AccountID, "error", err)
	}
	if err := s.repo.DeleteOfflineRealized(ctx, payload.AccountID); err != nil {
		slog.Warn("deregister: delete offline realized failed", "account_id", payload.AccountID, "error", err)
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

	// Store synced positions under the owner's user_id so they reconcile with order-fill positions.
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
			DayPnl:           p.DayPnl,
			DayPnlPct:        p.DayPnlPct,
			Source:           p.Source,
			AsOf:             p.AsOf,
		}
		if err := s.repo.UpsertPositionFromSync(ctx, userID, p.Symbol, sync.TradingMode, sync.AccountID, p.Qty, p.AvgCost, val); err != nil {
			slog.Warn("upsert position from sync failed", "symbol", p.Symbol, "error", err)
		}
		presentSymbols = append(presentSymbols, p.Symbol)
	}
	if err := s.repo.DeletePositionsNotInSync(ctx, sync.AccountID, userID, presentSymbols); err != nil {
		slog.Warn("delete positions not in sync failed", "account_id", sync.AccountID, "error", err)
	}

	// Realized P&L upsert lands OUTSIDE the positions loop and AFTER DeletePositionsNotInSync so a
	// flat/full-close recompute (positions: []) still records; the nil pointer keeps broker syncs out.
	if sync.RealizedPnl != nil {
		if err := s.repo.UpsertOfflineRealized(ctx, sync.AccountID, userID, sync.TradingMode, *sync.RealizedPnl); err != nil {
			slog.Warn("upsert offline realized failed", "account_id", sync.AccountID, "error", err)
		}
	}
}

// bracketUpdatePayload is the shape of the order.bracket_updated event payload. An empty
// StopOrderID/TakeProfitOrderID means "cleared", not "leave the existing value alone".
type bracketUpdatePayload struct {
	UserID            string `json:"user_id"`
	AccountID         string `json:"account_id"`
	Symbol            string `json:"symbol"`
	TradingMode       string `json:"trading_mode"`
	StopOrderID       string `json:"stop_order_id"`
	TakeProfitOrderID string `json:"take_profit_order_id"`
}

// ConsumeBracketUpdates subscribes to ledger StreamEvents filtered on "order.bracket_updated"
// and persists the resting bracket leg order IDs onto the matching position row.
func (s *PortfolioService) ConsumeBracketUpdates(ctx context.Context) {
	s.consumeEventStream(ctx, "bracket update", "order.bracket_updated", s.processBracketUpdate)
}

func (s *PortfolioService) processBracketUpdate(ctx context.Context, event *ledgerv1.LedgerEvent) {
	upd, err := parseBracketUpdatePayload(event.Payload)
	if err != nil {
		slog.Warn("parse bracket update payload", "error", err)
		return
	}
	if upd.AccountID == "" || upd.Symbol == "" {
		return
	}
	if err := s.repo.UpdatePositionBracket(ctx, upd.UserID, upd.Symbol, upd.TradingMode, upd.AccountID, upd.StopOrderID, upd.TakeProfitOrderID); err != nil {
		slog.Warn("update position bracket failed", "symbol", upd.Symbol, "error", err)
	}
}

// parseBracketUpdatePayload is the pure JSON-parse step of processBracketUpdate, split out so it can
// be unit-tested (repo is a concrete type, not a mockable interface).
func parseBracketUpdatePayload(payload *structpb.Struct) (bracketUpdatePayload, error) {
	if payload == nil {
		return bracketUpdatePayload{}, fmt.Errorf("nil payload")
	}
	raw, err := payload.MarshalJSON()
	if err != nil {
		return bracketUpdatePayload{}, err
	}
	var upd bracketUpdatePayload
	if err := json.Unmarshal(raw, &upd); err != nil {
		return bracketUpdatePayload{}, err
	}
	return upd, nil
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
	s.consumeEventStream(ctx, "balance sync", "account.balance.synced", s.processBalanceSync)
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

// buildAccountPortfolio assembles a Portfolio for one account. The broker is authoritative for cash,
// buying power, and equity; when bal is nil, equity falls back to the summed position market value.
func (s *PortfolioService) buildAccountPortfolio(ctx context.Context, accountID string, bal *repository.AccountBalance) (*portfoliov1.Portfolio, error) {
	positions, err := s.repo.ListPositionsByAccount(ctx, accountID, "")
	if err != nil {
		return nil, err
	}
	// enrichPositions keeps broker-valued positions and mid-quote-enriches only those the broker didn't value.
	s.enrichPositions(ctx, positions)

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
	// Offline-account realized P&L set with proto3 presence so an offline $0 differs from a broker unset;
	// populated identically in GetPortfolio for parity. Broker accounts have no row → left unset.
	if v, ok, err := s.repo.GetOfflineRealized(ctx, accountID); err == nil && ok {
		portfolio.RealizedPnl = proto.Float64(v)
	}
	return portfolio, nil
}

// ListPortfolios returns a Portfolio per broker account: a specific account_id returns just that one;
// without one it aggregates every account owned by the requesting user (from x-user-id).
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

	userID := middleware.FromContext(ctx).UserID
	if userID == "" {
		return &portfoliov1.ListPortfoliosResponse{}, nil
	}
	accounts, err := s.repo.ListAccountBalancesByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	portfolios := make([]*portfoliov1.Portfolio, 0, len(accounts))
	balanceIDs := make([]string, 0, len(accounts))
	for _, acct := range accounts {
		bal := acct.Balance
		portfolio, err := s.buildAccountPortfolio(ctx, acct.AccountID, &bal)
		if err != nil {
			slog.Warn("ListPortfolios: build account portfolio failed", "account_id", acct.AccountID, "error", err)
			continue
		}
		portfolios = append(portfolios, portfolio)
		balanceIDs = append(balanceIDs, acct.AccountID)
	}

	// Offline accounts have no account_balances row, so append them separately for combined-view parity.
	// A nil balance yields 0 cash/BP/day-P&L and equity = summed market value; a lookup failure is non-fatal.
	if offlineIDs, err := s.repo.ListOfflineAccountIdsByUser(ctx, userID); err != nil {
		slog.Warn("ListPortfolios: list offline account ids failed", "user_id", userID, "error", err)
	} else {
		for _, id := range offlineIDsToAppend(balanceIDs, offlineIDs) {
			portfolio, err := s.buildAccountPortfolio(ctx, id, nil)
			if err != nil {
				slog.Warn("ListPortfolios: build offline account portfolio failed", "account_id", id, "error", err)
				continue
			}
			portfolios = append(portfolios, portfolio)
		}
	}
	return &portfoliov1.ListPortfoliosResponse{Portfolios: portfolios}, nil
}

// offlineIDsToAppend returns the offline account IDs not already in the balances-sourced set,
// deduped so an account is never built twice.
func offlineIDsToAppend(balanceAccountIDs, offlineIDs []string) []string {
	seen := make(map[string]struct{}, len(balanceAccountIDs))
	for _, id := range balanceAccountIDs {
		seen[id] = struct{}{}
	}
	var out []string
	for _, id := range offlineIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// ─── Watchlists (feature 058) ────────────────────────────────────────────────
// Ownership is enforced from x-user-id (load row, compare user_id, else PermissionDenied). Caps are
// read fresh from config per mutation. Ledger emission is non-fatal (logs and drops, never fails the write).

const (
	defaultMaxWatchlistsPerUser = 50
	defaultMaxSymbolsPerList    = 500
	// signalWatchlistDefaultName is the cosmetic display name for the system-managed signals watchlist —
	// NOT identity (the system_managed flag is), so it may coexist with a user's same-named manual list.
	signalWatchlistDefaultName = "Signals"
)

// WatchlistStore is the persistence surface the watchlist RPCs depend on. The
// concrete implementation is *repository.WatchlistRepo; tests inject a stub.
type WatchlistStore interface {
	Create(ctx context.Context, userID, name, description, defaultStrategyID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error)
	GetByID(ctx context.Context, watchlistID string) (*portfoliov1.Watchlist, error)
	ListByUser(ctx context.Context, userID string, pageSize int, pageToken string) ([]*portfoliov1.Watchlist, string, error)
	Update(ctx context.Context, watchlistID, name, description string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error)
	// UpdatePartial writes only the flagged scalar columns; bindings untouched. ErrWatchlistNotFound
	// when the row is absent.
	UpdatePartial(ctx context.Context, watchlistID string, patch repository.WatchlistPatch) (*portfoliov1.Watchlist, error)
	Delete(ctx context.Context, watchlistID string) error
	AddSymbols(ctx context.Context, watchlistID string, bindings []*portfoliov1.WatchlistBinding) (*portfoliov1.Watchlist, error)
	RemoveSymbols(ctx context.Context, watchlistID string, symbols []string) (*portfoliov1.Watchlist, error)
	// UpdateBinding rebinds one symbol's strategy_id, returning the updated binding and the parent list's
	// bumped updated_at; ErrBindingNotFound when the (watchlist_id, symbol) row is absent.
	UpdateBinding(ctx context.Context, watchlistID, symbol, strategyID string) (*portfoliov1.WatchlistBinding, time.Time, error)
	// UpdateBindings atomically rebinds a set of symbols to one strategy_id; returns the changed bindings
	// and parent updated_at, or ErrBindingNotFound if any symbol is absent (whole batch rolled back).
	UpdateBindings(ctx context.Context, watchlistID string, symbols []string, strategyID string) ([]*portfoliov1.WatchlistBinding, time.Time, error)
	CountByUser(ctx context.Context, userID string) (int, error)
	EnsureSystemManaged(ctx context.Context, userID, defaultName string) (*portfoliov1.Watchlist, error)
	// ListAllSymbols returns the distinct union of watchlist symbols across ALL users — cross-user,
	// not scoped to a caller.
	ListAllSymbols(ctx context.Context) ([]string, error)
}

// watchlistConfig is the config slice the watchlist caps read (injectable in tests).
type watchlistConfig interface {
	GetInt(key string, defaultVal int64) int64
}

// normalizeSymbols uppercases, trims, and de-duplicates a symbol list, dropping empties and
// preserving first-seen order.
func normalizeSymbols(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		u := strings.ToUpper(strings.TrimSpace(s))
		if u == "" {
			continue
		}
		if _, dup := seen[u]; dup {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	return out
}

// normalizeBindings is the binding analog of normalizeSymbols: uppercase/trim symbol, drop empties,
// dedupe by symbol (first-seen wins, keeping its strategy_id), preserving first-seen order.
func normalizeBindings(in []*portfoliov1.WatchlistBinding) []*portfoliov1.WatchlistBinding {
	seen := make(map[string]struct{}, len(in))
	out := make([]*portfoliov1.WatchlistBinding, 0, len(in))
	for _, b := range in {
		sym := strings.ToUpper(strings.TrimSpace(b.GetSymbol()))
		if sym == "" {
			continue
		}
		if _, dup := seen[sym]; dup {
			continue
		}
		seen[sym] = struct{}{}
		out = append(out, &portfoliov1.WatchlistBinding{
			Symbol:     sym,
			StrategyId: strings.TrimSpace(b.GetStrategyId()),
			Source:     b.GetSource(), // preserve provenance so SIGNAL survives to insert
		})
	}
	return out
}

// requestBindings resolves the authoritative binding set: `bindings` takes precedence; an empty
// `bindings` falls back to legacy flat `symbols` mapped to unbound bindings (strategy_id="").
func requestBindings(bindings []*portfoliov1.WatchlistBinding, symbols []string, defaultStrategyID string) []*portfoliov1.WatchlistBinding {
	var out []*portfoliov1.WatchlistBinding
	if len(bindings) > 0 {
		out = normalizeBindings(bindings)
	} else {
		tmp := make([]*portfoliov1.WatchlistBinding, 0, len(symbols))
		for _, s := range symbols {
			tmp = append(tmp, &portfoliov1.WatchlistBinding{Symbol: s})
		}
		out = normalizeBindings(tmp)
	}
	// Single fill site — wraps BOTH branches so a flat-`symbols` add inherits the default too.
	return applyDefaultStrategy(out, defaultStrategyID)
}

// applyDefaultStrategy stamps the default strategy onto add-time bindings only when the default is
// non-empty, the binding is unbound, AND its source is NOT SIGNAL. Add-time only — never retroactive.
func applyDefaultStrategy(bindings []*portfoliov1.WatchlistBinding, defaultStrategyID string) []*portfoliov1.WatchlistBinding {
	if defaultStrategyID == "" {
		return bindings
	}
	for _, b := range bindings {
		if b.GetStrategyId() == "" && b.GetSource() != portfoliov1.WatchlistEntrySource_WATCHLIST_ENTRY_SOURCE_SIGNAL {
			b.StrategyId = defaultStrategyID
		}
	}
	return bindings
}

// bindingSymbols flattens bindings to their symbols (for cap counting / union math).
func bindingSymbols(bindings []*portfoliov1.WatchlistBinding) []string {
	out := make([]string, 0, len(bindings))
	for _, b := range bindings {
		out = append(out, b.GetSymbol())
	}
	return out
}

func (s *PortfolioService) maxWatchlistsPerUser() int {
	return int(s.wlCfg.GetInt("portfolio.watchlist.max_per_user", defaultMaxWatchlistsPerUser))
}

func (s *PortfolioService) maxSymbolsPerList() int {
	return int(s.wlCfg.GetInt("portfolio.watchlist.max_symbols_per_list", defaultMaxSymbolsPerList))
}

// requireUserID returns the caller's propagated user id or an InvalidArgument error.
func requireUserID(ctx context.Context) (string, error) {
	userID := middleware.FromContext(ctx).UserID
	if userID == "" {
		return "", connect.NewError(connect.CodeInvalidArgument, errors.New("missing user identity"))
	}
	return userID, nil
}

// loadOwned fetches a watchlist and enforces ownership: NotFound if absent, PermissionDenied if
// owned by someone else.
func (s *PortfolioService) loadOwned(ctx context.Context, userID, watchlistID string) (*portfoliov1.Watchlist, error) {
	if watchlistID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("watchlist_id required"))
	}
	wl, err := s.watchlists.GetByID(ctx, watchlistID)
	if err != nil {
		if errors.Is(err, repository.ErrWatchlistNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("watchlist not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if wl.UserId != userID {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("watchlist not owned by caller"))
	}
	return wl, nil
}

// CreateWatchlist creates a new watchlist for the calling user.
func (s *PortfolioService) CreateWatchlist(ctx context.Context, req *portfoliov1.CreateWatchlistRequest) (*portfoliov1.CreateWatchlistResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.GetName()) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name required"))
	}
	// Add-time default: the create-request default binds initial bare/MANUAL symbols.
	bindings := requestBindings(req.GetBindings(), req.GetSymbols(), req.GetDefaultStrategyId())
	if len(bindings) > s.maxSymbolsPerList() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("too many symbols: %d exceeds max %d", len(bindings), s.maxSymbolsPerList()))
	}
	count, err := s.watchlists.CountByUser(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if count >= s.maxWatchlistsPerUser() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("watchlist limit reached: %d", s.maxWatchlistsPerUser()))
	}
	wl, err := s.watchlists.Create(ctx, userID, req.GetName(), req.GetDescription(), strings.TrimSpace(req.GetDefaultStrategyId()), bindings)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.created", "watchlist:"+wl.WatchlistId, map[string]interface{}{
		"user_id": userID, "watchlist_id": wl.WatchlistId, "name": wl.Name,
	})
	return &portfoliov1.CreateWatchlistResponse{Watchlist: wl}, nil
}

// EnsureSignalWatchlist find-or-creates the caller's single system-managed signals watchlist.
// Ownership from x-user-id; idempotent and race-safe.
func (s *PortfolioService) EnsureSignalWatchlist(ctx context.Context, _ *portfoliov1.EnsureSignalWatchlistRequest) (*portfoliov1.EnsureSignalWatchlistResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	wl, err := s.watchlists.EnsureSystemManaged(ctx, userID, signalWatchlistDefaultName)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return &portfoliov1.EnsureSignalWatchlistResponse{Watchlist: wl}, nil
}

// ListAllWatchlistSymbols returns the cross-user distinct union of watchlist symbols. Gated by the
// x-internal-caller allow-list (NOT the admin x-access-scope bit); no grant → PermissionDenied.
func (s *PortfolioService) ListAllWatchlistSymbols(ctx context.Context, _ *portfoliov1.ListAllWatchlistSymbolsRequest) (*portfoliov1.ListAllWatchlistSymbolsResponse, error) {
	if !hasInternalCallerAuthority(ctx, "ListAllWatchlistSymbols") {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("cross-user watchlist enumeration is internal-caller-gated"))
	}
	syms, err := s.watchlists.ListAllSymbols(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return &portfoliov1.ListAllWatchlistSymbolsResponse{Symbols: syms}, nil
}

// GetWatchlist returns a single watchlist owned by the caller.
func (s *PortfolioService) GetWatchlist(ctx context.Context, req *portfoliov1.GetWatchlistRequest) (*portfoliov1.GetWatchlistResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	wl, err := s.loadOwned(ctx, userID, req.GetWatchlistId())
	if err != nil {
		return nil, err
	}
	return &portfoliov1.GetWatchlistResponse{Watchlist: wl}, nil
}

// ListWatchlists returns the caller's watchlists, paginated.
func (s *PortfolioService) ListWatchlists(ctx context.Context, req *portfoliov1.ListWatchlistsRequest) (*portfoliov1.ListWatchlistsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	pageSize := 0
	pageToken := ""
	if p := req.GetPage(); p != nil {
		pageSize = int(p.GetPageSize())
		pageToken = p.GetPageToken()
	}
	wls, next, err := s.watchlists.ListByUser(ctx, userID, pageSize, pageToken)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return &portfoliov1.ListWatchlistsResponse{
		Watchlists: wls,
		Page:       &commonv1.PageResponse{NextPageToken: next},
	}, nil
}

// watchlistMaskPaths is the closed allowlist of maskable UpdateWatchlist paths (scalar only —
// bindings excluded). repository.UpdatePartial keys column identifiers off this map (injection-safe).
var watchlistMaskPaths = map[string]bool{
	"name":                true,
	"description":         true,
	"default_strategy_id": true,
}

// UpdateWatchlist selects by update_mask PRESENCE: unset → legacy replace-all of name/description/
// bindings (default_strategy_id rejected); set → partial update of masked scalar paths only.
func (s *PortfolioService) UpdateWatchlist(ctx context.Context, req *portfoliov1.UpdateWatchlistRequest) (*portfoliov1.UpdateWatchlistResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.loadOwned(ctx, userID, req.GetWatchlistId()); err != nil {
		return nil, err
	}

	if mask := req.GetUpdateMask(); mask != nil {
		// ── Partial (field-mask) path ──────────────────────────────────────────────
		paths := mask.GetPaths()
		if len(paths) == 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("update_mask present but empty"))
		}
		var patch repository.WatchlistPatch
		for _, p := range paths {
			if !watchlistMaskPaths[p] {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unknown update_mask path: %q", p))
			}
			switch p {
			case "name":
				if strings.TrimSpace(req.GetName()) == "" {
					return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name required"))
				}
				patch.SetName, patch.Name = true, req.GetName()
			case "description":
				patch.SetDescription, patch.Description = true, req.GetDescription()
			case "default_strategy_id":
				patch.SetDefaultStrategy, patch.DefaultStrategyID = true, strings.TrimSpace(req.GetDefaultStrategyId())
			}
		}
		wl, err := s.watchlists.UpdatePartial(ctx, req.GetWatchlistId(), patch)
		if err != nil {
			if errors.Is(err, repository.ErrWatchlistNotFound) {
				return nil, connect.NewError(connect.CodeNotFound, errors.New("watchlist not found"))
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+wl.WatchlistId, map[string]interface{}{
			"user_id": userID, "watchlist_id": wl.WatchlistId,
		})
		return &portfoliov1.UpdateWatchlistResponse{Watchlist: wl}, nil
	}

	// ── Legacy replace-all path (no mask) ────────────────────────────────────────
	// default_strategy_id is not written here — fail loud rather than silently no-op.
	if strings.TrimSpace(req.GetDefaultStrategyId()) != "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("default_strategy_id requires update_mask"))
	}
	if strings.TrimSpace(req.GetName()) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("name required"))
	}
	// Replace-all opts out of the add-time default (pass "") — setting a default never retroactively rebinds.
	bindings := requestBindings(req.GetBindings(), req.GetSymbols(), "")
	if len(bindings) > s.maxSymbolsPerList() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("too many symbols: %d exceeds max %d", len(bindings), s.maxSymbolsPerList()))
	}
	wl, err := s.watchlists.Update(ctx, req.GetWatchlistId(), req.GetName(), req.GetDescription(), bindings)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+wl.WatchlistId, map[string]interface{}{
		"user_id": userID, "watchlist_id": wl.WatchlistId,
	})
	return &portfoliov1.UpdateWatchlistResponse{Watchlist: wl}, nil
}

// UpdateWatchlistBinding rebinds one symbol's strategy without a replace-all (feature 167, FR-1).
func (s *PortfolioService) UpdateWatchlistBinding(ctx context.Context, req *portfoliov1.UpdateWatchlistBindingRequest) (*portfoliov1.UpdateWatchlistBindingResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.loadOwned(ctx, userID, req.GetWatchlistId()); err != nil {
		return nil, err
	}
	// Normalize the request symbol to match stored (uppercased/trimmed) rows.
	symbol := strings.ToUpper(strings.TrimSpace(req.GetSymbol()))
	if symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("symbol required"))
	}
	// strategy_id == "" passes through as a valid unbind.
	binding, updatedAt, err := s.watchlists.UpdateBinding(ctx, req.GetWatchlistId(), symbol, strings.TrimSpace(req.GetStrategyId()))
	if err != nil {
		if errors.Is(err, repository.ErrBindingNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("symbol not in watchlist")) // AC-3
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+req.GetWatchlistId(), map[string]interface{}{
		"user_id": userID, "watchlist_id": req.GetWatchlistId(), "symbol": symbol,
	})
	return &portfoliov1.UpdateWatchlistBindingResponse{
		Binding:   binding,
		UpdatedAt: timestamppb.New(updatedAt),
	}, nil
}

// UpdateWatchlistBindings atomically assigns one strategy_id across a normalized+deduped symbol set.
// Any symbol absent → whole batch rolled back → NotFound; strategy_id == "" unbinds the set.
func (s *PortfolioService) UpdateWatchlistBindings(ctx context.Context, req *portfoliov1.UpdateWatchlistBindingsRequest) (*portfoliov1.UpdateWatchlistBindingsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.loadOwned(ctx, userID, req.GetWatchlistId()); err != nil {
		return nil, err
	}
	symbols := normalizeSymbols(req.GetSymbols())
	if len(symbols) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("symbols required"))
	}
	// strategy_id == "" passes through as a valid bulk unbind.
	bindings, updatedAt, err := s.watchlists.UpdateBindings(ctx, req.GetWatchlistId(), symbols, strings.TrimSpace(req.GetStrategyId()))
	if err != nil {
		if errors.Is(err, repository.ErrBindingNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("one or more symbols not in watchlist")) // AC-4
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+req.GetWatchlistId(), map[string]interface{}{
		"user_id": userID, "watchlist_id": req.GetWatchlistId(),
	})
	return &portfoliov1.UpdateWatchlistBindingsResponse{
		Bindings:  bindings,
		UpdatedAt: timestamppb.New(updatedAt),
	}, nil
}

// DeleteWatchlist hard-deletes a watchlist owned by the caller.
func (s *PortfolioService) DeleteWatchlist(ctx context.Context, req *portfoliov1.DeleteWatchlistRequest) (*portfoliov1.DeleteWatchlistResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	wl, err := s.loadOwned(ctx, userID, req.GetWatchlistId())
	if err != nil {
		return nil, err
	}
	// A system-managed watchlist is delete-protected — refused on resource state (FailedPrecondition),
	// not authorization.
	if wl.GetSystemManaged() {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("cannot delete a system-managed watchlist"))
	}
	if err := s.watchlists.Delete(ctx, req.GetWatchlistId()); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.deleted", "watchlist:"+req.GetWatchlistId(), map[string]interface{}{
		"user_id": userID, "watchlist_id": req.GetWatchlistId(),
	})
	return &portfoliov1.DeleteWatchlistResponse{}, nil
}

// AddWatchlistSymbols adds symbols, enforcing the per-list cap on the resulting set.
func (s *PortfolioService) AddWatchlistSymbols(ctx context.Context, req *portfoliov1.AddWatchlistSymbolsRequest) (*portfoliov1.AddWatchlistSymbolsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := s.loadOwned(ctx, userID, req.GetWatchlistId())
	if err != nil {
		return nil, err
	}
	// Add-time default: a bare/MANUAL add inherits the watchlist's persisted default; SIGNAL-sourced
	// adds are skipped inside applyDefaultStrategy.
	add := requestBindings(req.GetBindings(), req.GetSymbols(), existing.GetDefaultStrategyId())
	// Resulting count = union of current symbols + newly-added symbols (both normalized).
	resulting := normalizeSymbols(append(append([]string{}, existing.Symbols...), bindingSymbols(add)...)) //nolint:staticcheck // SA1019: deprecated symbols mirror intentionally retained for old clients (feature 097)
	if len(resulting) > s.maxSymbolsPerList() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("too many symbols: %d exceeds max %d", len(resulting), s.maxSymbolsPerList()))
	}
	wl, err := s.watchlists.AddSymbols(ctx, req.GetWatchlistId(), add)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+wl.WatchlistId, map[string]interface{}{
		"user_id": userID, "watchlist_id": wl.WatchlistId,
	})
	return &portfoliov1.AddWatchlistSymbolsResponse{Watchlist: wl}, nil
}

// RemoveWatchlistSymbols removes symbols from a watchlist owned by the caller.
func (s *PortfolioService) RemoveWatchlistSymbols(ctx context.Context, req *portfoliov1.RemoveWatchlistSymbolsRequest) (*portfoliov1.RemoveWatchlistSymbolsResponse, error) {
	userID, err := requireUserID(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := s.loadOwned(ctx, userID, req.GetWatchlistId()); err != nil {
		return nil, err
	}
	wl, err := s.watchlists.RemoveSymbols(ctx, req.GetWatchlistId(), normalizeSymbols(req.GetSymbols()))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	s.emitEvent(ctx, "portfolio.watchlist.updated", "watchlist:"+wl.WatchlistId, map[string]interface{}{
		"user_id": userID, "watchlist_id": wl.WatchlistId,
	})
	return &portfoliov1.RemoveWatchlistSymbolsResponse{Watchlist: wl}, nil
}
