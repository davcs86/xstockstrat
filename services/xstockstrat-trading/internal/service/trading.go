package service

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// TradingService implements business logic for order placement, cancellation,
// and lifecycle management. Writes all events to xstockstrat-ledger.
type TradingService struct {
	cfg    *config.Config
	cfgW   *config.Watcher
	broker *broker.Client
	ledger ledgerv1.LedgerServiceClient
	notify notifyv1.NotifyServiceClient
	// portfolio is used for pre-trade risk checks (non-blocking on failure).
	portfolio portfoliov1.PortfolioServiceClient
	// repo persists orders to trading.orders hypertable.
	repo *repository.TradingRepo
	// In-memory order store for active fan-out and fill polling.
	// Orders are also written to DB on every state change.
	orders map[string]*tradingv1.Order
	// Fan-out channels for StreamOrderUpdates
	mu   sync.Mutex
	subs map[string]chan *tradingv1.Order
}

func NewTradingService(
	cfg *config.Config,
	cfgW *config.Watcher,
	brokerClient *broker.Client,
	repo *repository.TradingRepo,
) (*TradingService, error) {
	ledgerConn, err := grpc.NewClient(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	notifyConn, err := grpc.NewClient(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial notify: %w", err)
	}
	portfolioConn, err := grpc.NewClient(cfg.PortfolioEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial portfolio: %w", err)
	}
	return &TradingService{
		cfg:       cfg,
		cfgW:      cfgW,
		broker:    brokerClient,
		ledger:    ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:    notifyv1.NewNotifyServiceClient(notifyConn),
		portfolio: portfoliov1.NewPortfolioServiceClient(portfolioConn),
		repo:      repo,
		orders:    make(map[string]*tradingv1.Order),
		subs:      make(map[string]chan *tradingv1.Order),
	}, nil
}

// SubscribeOrderUpdates registers a subscriber channel for order update broadcasts.
func (s *TradingService) SubscribeOrderUpdates(id string) <-chan *tradingv1.Order {
	ch := make(chan *tradingv1.Order, 64)
	s.mu.Lock()
	s.subs[id] = ch
	s.mu.Unlock()
	return ch
}

// UnsubscribeOrderUpdates removes a subscriber channel.
func (s *TradingService) UnsubscribeOrderUpdates(id string) {
	s.mu.Lock()
	if ch, ok := s.subs[id]; ok {
		close(ch)
		delete(s.subs, id)
	}
	s.mu.Unlock()
}

// broadcastOrder fans out an order update to all subscribers.
func (s *TradingService) broadcastOrder(order *tradingv1.Order) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ch := range s.subs {
		select {
		case ch <- order:
		default:
		}
	}
}

func (s *TradingService) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
	// Check platform maintenance mode.
	if s.cfgW.GetBool("platform.maintenance_mode", false) {
		return nil, fmt.Errorf("platform is in maintenance mode — trading halted")
	}

	// Non-blocking portfolio risk check: log warnings but never block order placement.
	s.checkPortfolioRisk(ctx, req)

	// Resolve trading mode: request field takes precedence; fall back to live config, then env.
	mode := s.resolveTradingMode(req.TradingMode)

	// Check approval thresholds from live config.
	approvalQtyThreshold := s.cfgW.GetFloat("trading.approval.require_above_qty", 500)
	approvalNotionalThreshold := s.cfgW.GetFloat("trading.approval.require_above_notional", 50000)
	requiresApproval := req.Qty > approvalQtyThreshold ||
		(req.LimitPrice > 0 && req.Qty*req.LimitPrice > approvalNotionalThreshold)

	orderID := uuid.New().String()
	status := tradingv1.OrderStatus_ORDER_STATUS_NEW
	if requiresApproval {
		status = tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL
	}

	order := &tradingv1.Order{
		OrderId:       orderID,
		ClientOrderId: req.ClientOrderId,
		Symbol:        req.Symbol,
		Side:          req.Side,
		OrderType:     req.OrderType,
		Status:        status,
		Qty:           req.Qty,
		FilledQty:     0,
		LimitPrice:    req.LimitPrice,
		StopPrice:     req.StopPrice,
		TimeInForce:   req.TimeInForce,
		StrategyId:    req.StrategyId,
		UserId:        req.UserId,
		TradingMode:   mode,
		CreatedAt:     timestamppb.New(time.Now()),
		UpdatedAt:     timestamppb.New(time.Now()),
	}

	s.mu.Lock()
	s.orders[orderID] = order
	s.mu.Unlock()

	// Persist order to DB.
	if err := s.repo.UpsertOrder(ctx, order); err != nil {
		slog.Warn("db upsert order failed", "order_id", orderID, "error", err)
	}

	go s.emitLedgerEvent(context.Background(), "order.created", orderID, map[string]interface{}{
		"symbol": order.Symbol, "side": order.Side.String(), "qty": order.Qty,
		"status": status.String(), "trading_mode": mode.String(),
	})

	if requiresApproval {
		go s.emitLedgerEvent(context.Background(), "order.approval_requested", orderID, map[string]interface{}{
			"order_id": orderID, "symbol": order.Symbol, "qty": order.Qty,
			"limit_price": order.LimitPrice, "user_id": order.UserId,
		})
		go s.emitApprovalAlert(context.Background(), order)
		slog.Info("order pending approval", "order_id", orderID, "symbol", req.Symbol)
		return order, nil
	}

	// Emit order.submitted before calling broker — signals intent to submit.
	go s.emitLedgerEvent(context.Background(), "order.submitted", orderID, map[string]interface{}{
		"order_id": orderID, "symbol": order.Symbol, "side": order.Side.String(),
		"qty": order.Qty, "trading_mode": mode.String(),
	})

	// Submit to Alpaca broker (paper or live based on resolved mode).
	brokerReq := s.buildBrokerRequest(req, mode)
	alpacaOrder, err := s.broker.SubmitOrder(ctx, brokerReq)
	if err != nil {
		order.Status = tradingv1.OrderStatus_ORDER_STATUS_REJECTED
		order.UpdatedAt = timestamppb.New(time.Now())
		go s.emitLedgerEvent(context.Background(), "order.broker_rejected", orderID, map[string]interface{}{
			"order_id": orderID, "error": err.Error(), "trading_mode": mode.String(),
		})
		_ = s.repo.UpsertOrder(context.Background(), order)
		slog.Error("broker rejected order", "order_id", orderID, "error", err)
		return nil, fmt.Errorf("broker submission failed: %w", err)
	}

	// Update order with broker-assigned fields.
	order.BrokerOrderId = alpacaOrder.ID
	order.Status = alpacaStatusToProto(alpacaOrder.Status)
	order.UpdatedAt = timestamppb.New(time.Now())
	if fq, err := strconv.ParseFloat(alpacaOrder.FilledQty, 64); err == nil {
		order.FilledQty = fq
	}
	if fp, err := strconv.ParseFloat(alpacaOrder.FilledAvgPrice, 64); err == nil {
		order.FilledAvgPrice = fp
	}

	// Persist updated order with broker fields.
	if err := s.repo.UpsertOrder(context.Background(), order); err != nil {
		slog.Warn("db upsert after broker submit failed", "order_id", orderID, "error", err)
	}

	go s.emitLedgerEvent(context.Background(), "order.broker_submitted", orderID, map[string]interface{}{
		"order_id": orderID, "broker_order_id": alpacaOrder.ID,
		"broker_status": alpacaOrder.Status, "trading_mode": mode.String(),
	})

	slog.Info("order submitted to broker", "order_id", orderID, "broker_order_id", alpacaOrder.ID,
		"trading_mode", mode.String(), "broker_status", alpacaOrder.Status)
	return order, nil
}

func (s *TradingService) CancelOrder(ctx context.Context, req *tradingv1.CancelOrderRequest) (*tradingv1.CancelOrderResponse, error) {
	s.mu.Lock()
	order, ok := s.orders[req.OrderId]
	s.mu.Unlock()
	if !ok {
		// Fall back to DB lookup.
		var err error
		order, err = s.repo.GetOrder(ctx, req.OrderId)
		if err != nil || order == nil {
			return nil, fmt.Errorf("order %s not found", req.OrderId)
		}
		s.mu.Lock()
		s.orders[order.OrderId] = order
		s.mu.Unlock()
	}

	// Cancel at broker if we have a broker order ID.
	if order.BrokerOrderId != "" {
		if err := s.broker.CancelOrder(ctx, order.BrokerOrderId); err != nil {
			slog.Warn("broker cancel failed", "order_id", req.OrderId, "broker_order_id", order.BrokerOrderId, "error", err)
			// Continue with internal cancellation — broker may have already filled/canceled.
		}
	}

	order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	order.UpdatedAt = timestamppb.New(time.Now())

	_ = s.repo.UpsertOrder(ctx, order)

	go s.emitLedgerEvent(context.Background(), "order.canceled", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": req.UserId,
	})
	s.broadcastOrder(order)

	return &tradingv1.CancelOrderResponse{Success: true, Order: order}, nil
}

func (s *TradingService) GetOrder(ctx context.Context, req *tradingv1.GetOrderRequest) (*tradingv1.Order, error) {
	s.mu.Lock()
	order, ok := s.orders[req.OrderId]
	s.mu.Unlock()
	if ok {
		return order, nil
	}
	// Fall back to DB.
	order, err := s.repo.GetOrder(ctx, req.OrderId)
	if err != nil || order == nil {
		return nil, fmt.Errorf("order %s not found", req.OrderId)
	}
	return order, nil
}

func (s *TradingService) ListOrders(ctx context.Context, req *tradingv1.ListOrdersRequest) (*tradingv1.ListOrdersResponse, error) {
	orders, err := s.repo.ListOrders(ctx, req.UserId, req.Status, req.TradingMode, req.StrategyId)
	if err != nil {
		slog.Warn("db list orders failed, falling back to in-memory", "error", err)
		// Fall back to in-memory.
		var mem []*tradingv1.Order
		s.mu.Lock()
		for _, o := range s.orders {
			if req.UserId != "" && o.UserId != req.UserId {
				continue
			}
			if req.Status != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED && o.Status != req.Status {
				continue
			}
			if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED && o.TradingMode != req.TradingMode {
				continue
			}
			mem = append(mem, o)
		}
		s.mu.Unlock()
		return &tradingv1.ListOrdersResponse{Orders: mem}, nil
	}
	return &tradingv1.ListOrdersResponse{Orders: orders}, nil
}

func (s *TradingService) StreamOrderUpdates(req *tradingv1.StreamOrderUpdatesRequest, stream tradingv1.TradingService_StreamOrderUpdatesServer) error {
	// Send current snapshot of matching orders.
	s.mu.Lock()
	snapshot := make([]*tradingv1.Order, 0)
	for _, order := range s.orders {
		if req.UserId != "" && order.UserId != req.UserId {
			continue
		}
		snapshot = append(snapshot, order)
	}
	s.mu.Unlock()

	for _, order := range snapshot {
		if err := stream.Send(order); err != nil {
			return err
		}
	}

	// Wait for context cancellation (caller disconnects).
	<-stream.Context().Done()
	return nil
}

// StartFillPoller polls submitted broker orders every 5s to detect fills.
// On status change it emits the appropriate ledger event and notify alert.
func (s *TradingService) StartFillPoller(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.pollFills(ctx)
		}
	}
}

func (s *TradingService) pollFills(ctx context.Context) {
	// Collect in-flight orders from in-memory map.
	s.mu.Lock()
	candidates := make([]*tradingv1.Order, 0)
	for _, o := range s.orders {
		if o.BrokerOrderId == "" {
			continue
		}
		if o.Status == tradingv1.OrderStatus_ORDER_STATUS_FILLED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_CANCELED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_REJECTED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_EXPIRED {
			continue
		}
		candidates = append(candidates, o)
	}
	s.mu.Unlock()

	for _, order := range candidates {
		alpacaOrder, err := s.broker.GetOrder(ctx, order.BrokerOrderId)
		if err != nil {
			slog.Warn("fill poll: broker GetOrder failed", "order_id", order.OrderId, "error", err)
			continue
		}

		newStatus := alpacaStatusToProto(alpacaOrder.Status)
		if newStatus == order.Status {
			continue
		}

		// Update order with latest broker state.
		order.Status = newStatus
		order.UpdatedAt = timestamppb.New(time.Now())
		if fq, err := strconv.ParseFloat(alpacaOrder.FilledQty, 64); err == nil {
			order.FilledQty = fq
		}
		if fp, err := strconv.ParseFloat(alpacaOrder.FilledAvgPrice, 64); err == nil {
			order.FilledAvgPrice = fp
		}

		if err := s.repo.UpsertOrder(ctx, order); err != nil {
			slog.Warn("fill poll: db upsert failed", "order_id", order.OrderId, "error", err)
		}

		s.broadcastOrder(order)

		switch newStatus {
		case tradingv1.OrderStatus_ORDER_STATUS_FILLED:
			go s.emitLedgerEvent(context.Background(), "order.filled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
				"qty": order.Qty, "fill_price": order.FilledAvgPrice,
				"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
			})
			go s.emitFillAlert(context.Background(), order)
			slog.Info("order filled", "order_id", order.OrderId, "symbol", order.Symbol,
				"qty", order.Qty, "fill_price", order.FilledAvgPrice)

		case tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
			go s.emitLedgerEvent(context.Background(), "order.partially_filled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
				"filled_qty": order.FilledQty, "fill_price": order.FilledAvgPrice,
				"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
			})

		case tradingv1.OrderStatus_ORDER_STATUS_CANCELED:
			go s.emitLedgerEvent(context.Background(), "order.canceled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
			})

		case tradingv1.OrderStatus_ORDER_STATUS_REJECTED:
			go s.emitLedgerEvent(context.Background(), "order.rejected", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
			})
		}
	}
}

// checkPortfolioRisk makes a non-blocking GetPortfolio call to validate position
// concentration limits before placing an order. Warnings are logged but never
// block order placement — portfolio unavailability must not halt trading.
func (s *TradingService) checkPortfolioRisk(ctx context.Context, req *tradingv1.PlaceOrderRequest) {
	if req.UserId == "" {
		return
	}
	maxPositionPct := s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05)
	if maxPositionPct <= 0 {
		return
	}

	riskCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	portfolio, err := s.portfolio.GetPortfolio(riskCtx, &portfoliov1.GetPortfolioRequest{
		UserId:      req.UserId,
		TradingMode: req.TradingMode,
	})
	if err != nil {
		slog.Warn("portfolio risk check skipped", "user_id", req.UserId, "error", err)
		return
	}

	if portfolio.Equity <= 0 {
		return
	}

	// Estimate order notional value using limit price or a rough check.
	orderNotional := req.Qty * req.LimitPrice
	if orderNotional > 0 {
		pct := orderNotional / portfolio.Equity
		if pct > maxPositionPct {
			slog.Warn("order exceeds max_position_pct threshold",
				"order_id_pending", req.Symbol,
				"order_notional", orderNotional,
				"portfolio_equity", portfolio.Equity,
				"pct", pct,
				"max_pct", maxPositionPct,
			)
		}
	}
}

// resolveTradingMode determines the effective trading mode.
// Priority: explicit request field > live config key > env var default.
func (s *TradingService) resolveTradingMode(requested commonv1.TradingMode) commonv1.TradingMode {
	if requested != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		return requested
	}
	// Live config takes precedence over env default.
	paper := s.cfgW.GetBool("trading.broker.paper", s.cfg.AlpacaPaper)
	if paper {
		return commonv1.TradingMode_TRADING_MODE_PAPER
	}
	return commonv1.TradingMode_TRADING_MODE_LIVE
}

// buildBrokerRequest translates a PlaceOrderRequest to an Alpaca SubmitOrderRequest.
func (s *TradingService) buildBrokerRequest(req *tradingv1.PlaceOrderRequest, mode commonv1.TradingMode) broker.SubmitOrderRequest {
	sideMap := map[tradingv1.OrderSide]string{
		tradingv1.OrderSide_ORDER_SIDE_BUY:  "buy",
		tradingv1.OrderSide_ORDER_SIDE_SELL: "sell",
	}
	typeMap := map[tradingv1.OrderType]string{
		tradingv1.OrderType_ORDER_TYPE_MARKET:        "market",
		tradingv1.OrderType_ORDER_TYPE_LIMIT:         "limit",
		tradingv1.OrderType_ORDER_TYPE_STOP:          "stop",
		tradingv1.OrderType_ORDER_TYPE_STOP_LIMIT:    "stop_limit",
		tradingv1.OrderType_ORDER_TYPE_TRAILING_STOP: "trailing_stop",
	}

	tif := req.TimeInForce
	if tif == "" {
		tif = "day"
	}

	brokerReq := broker.SubmitOrderRequest{
		Symbol:        req.Symbol,
		Qty:           strconv.FormatFloat(req.Qty, 'f', -1, 64),
		Side:          sideMap[req.Side],
		Type:          typeMap[req.OrderType],
		TimeInForce:   tif,
		ClientOrderID: req.ClientOrderId,
	}
	if req.LimitPrice > 0 {
		brokerReq.LimitPrice = strconv.FormatFloat(req.LimitPrice, 'f', -1, 64)
	}
	if req.StopPrice > 0 {
		brokerReq.StopPrice = strconv.FormatFloat(req.StopPrice, 'f', -1, 64)
	}
	return brokerReq
}

// alpacaStatusToProto maps Alpaca order status strings to proto OrderStatus values.
func alpacaStatusToProto(s string) tradingv1.OrderStatus {
	switch s {
	case "new", "accepted", "pending_new":
		return tradingv1.OrderStatus_ORDER_STATUS_NEW
	case "partially_filled":
		return tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED
	case "filled":
		return tradingv1.OrderStatus_ORDER_STATUS_FILLED
	case "canceled", "done_for_day":
		return tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	case "expired":
		return tradingv1.OrderStatus_ORDER_STATUS_EXPIRED
	case "rejected", "stopped", "suspended", "calculated":
		return tradingv1.OrderStatus_ORDER_STATUS_REJECTED
	default:
		return tradingv1.OrderStatus_ORDER_STATUS_NEW
	}
}

func (s *TradingService) emitLedgerEvent(ctx context.Context, eventType, streamKey string, payload map[string]interface{}) {
	p, _ := structpb.NewStruct(payload)
	_, err := s.ledger.AppendEvent(ctx, &ledgerv1.AppendEventRequest{
		EventType:     eventType,
		SourceService: "xstockstrat-trading",
		StreamKey:     fmt.Sprintf("order:%s", streamKey),
		Payload:       p,
	})
	if err != nil {
		slog.Warn("ledger emit failed", "event_type", eventType, "error", err)
	}
}

func (s *TradingService) emitApprovalAlert(ctx context.Context, order *tradingv1.Order) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      "approval",
		Title:         fmt.Sprintf("Order requires approval: %s %s %.2f", order.Symbol, order.Side.String(), order.Qty),
		Body:          fmt.Sprintf("Order %s exceeds approval threshold. Please review and approve.", order.OrderId),
		SourceService: "xstockstrat-trading",
		TargetUserId:  order.UserId,
	})
	if err != nil {
		slog.Warn("notify emit failed", "order_id", order.OrderId, "error", err)
	}
}

func (s *TradingService) emitFillAlert(ctx context.Context, order *tradingv1.Order) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity: notifyv1.AlertSeverity_ALERT_SEVERITY_INFO,
		Category: "trade",
		Title: fmt.Sprintf("Order filled: %s %s %.2f @ %.4f",
			order.Symbol, order.Side.String(), order.Qty, order.FilledAvgPrice),
		Body: fmt.Sprintf("Order %s filled. Symbol: %s, Qty: %.2f, Avg Price: %.4f, Mode: %s",
			order.OrderId, order.Symbol, order.Qty, order.FilledAvgPrice, order.TradingMode.String()),
		SourceService: "xstockstrat-trading",
		TargetUserId:  order.UserId,
	})
	if err != nil {
		slog.Warn("notify fill alert failed", "order_id", order.OrderId, "error", err)
	}
}
