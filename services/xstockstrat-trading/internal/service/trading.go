package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/timestamppb"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
)

// TradingService implements business logic for order placement, cancellation,
// and lifecycle management. Writes all events to xstockstrat-ledger.
type TradingService struct {
	cfg    *config.Config
	cfgW   *config.Watcher
	ledger ledgerv1.LedgerServiceClient
	notify notifyv1.NotifyServiceClient
	// In-memory order store (replace with DB repository in production)
	orders map[string]*tradingv1.Order
}

func NewTradingService(cfg *config.Config, cfgW *config.Watcher) (*TradingService, error) {
	ledgerConn, err := grpc.Dial(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	notifyConn, err := grpc.Dial(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial notify: %w", err)
	}
	return &TradingService{
		cfg:    cfg,
		cfgW:   cfgW,
		ledger: ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify: notifyv1.NewNotifyServiceClient(notifyConn),
		orders: make(map[string]*tradingv1.Order),
	}, nil
}

func (s *TradingService) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
	// Check platform maintenance mode
	if s.cfgW.GetBool("platform.maintenance_mode", false) {
		return nil, fmt.Errorf("platform is in maintenance mode — trading halted")
	}

	// Check approval thresholds from live config
	approvalQtyThreshold := s.cfgW.GetInt("trading.approval.require_above_qty", 500)
	requiresApproval := int64(req.Qty) > approvalQtyThreshold

	orderID := uuid.New().String()
	status := tradingv1.OrderStatus_ORDER_STATUS_NEW
	if requiresApproval {
		status = tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL
	}

	order := &tradingv1.Order{
		OrderId:        orderID,
		ClientOrderId:  req.ClientOrderId,
		Symbol:         req.Symbol,
		Side:           req.Side,
		OrderType:      req.OrderType,
		Status:         status,
		Qty:            req.Qty,
		FilledQty:      0,
		LimitPrice:     req.LimitPrice,
		StopPrice:      req.StopPrice,
		TimeInForce:    req.TimeInForce,
		StrategyId:     req.StrategyId,
		UserId:         req.UserId,
		CreatedAt:      timestamppb.New(time.Now()),
		UpdatedAt:      timestamppb.New(time.Now()),
	}
	s.orders[orderID] = order

	// Write to ledger
	go s.emitLedgerEvent(context.Background(), "order.created", orderID, map[string]interface{}{
		"symbol": order.Symbol, "side": order.Side.String(), "qty": order.Qty, "status": status.String(),
	})

	// Alert if approval needed
	if requiresApproval {
		go s.emitApprovalAlert(context.Background(), order)
	}

	slog.Info("order placed", "order_id", orderID, "symbol", req.Symbol, "status", status.String())
	return order, nil
}

func (s *TradingService) CancelOrder(ctx context.Context, req *tradingv1.CancelOrderRequest) (*tradingv1.CancelOrderResponse, error) {
	order, ok := s.orders[req.OrderId]
	if !ok {
		return nil, fmt.Errorf("order %s not found", req.OrderId)
	}
	order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	order.UpdatedAt = timestamppb.New(time.Now())

	go s.emitLedgerEvent(context.Background(), "order.canceled", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": req.UserId,
	})

	return &tradingv1.CancelOrderResponse{Success: true, Order: order}, nil
}

func (s *TradingService) GetOrder(ctx context.Context, req *tradingv1.GetOrderRequest) (*tradingv1.Order, error) {
	order, ok := s.orders[req.OrderId]
	if !ok {
		return nil, fmt.Errorf("order %s not found", req.OrderId)
	}
	return order, nil
}

func (s *TradingService) ListOrders(ctx context.Context, req *tradingv1.ListOrdersRequest) (*tradingv1.ListOrdersResponse, error) {
	var orders []*tradingv1.Order
	for _, o := range s.orders {
		if req.UserId != "" && o.UserId != req.UserId {
			continue
		}
		if req.Status != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED && o.Status != req.Status {
			continue
		}
		orders = append(orders, o)
	}
	return &tradingv1.ListOrdersResponse{Orders: orders}, nil
}

func (s *TradingService) StreamOrderUpdates(req *tradingv1.StreamOrderUpdatesRequest, stream tradingv1.TradingService_StreamOrderUpdatesServer) error {
	// TODO: implement real-time streaming via channel or pub/sub
	// For now, send current snapshot and hold open
	for _, order := range s.orders {
		if req.UserId != "" && order.UserId != req.UserId {
			continue
		}
		if err := stream.Send(order); err != nil {
			return err
		}
	}
	<-stream.Context().Done()
	return nil
}

func (s *TradingService) emitLedgerEvent(ctx context.Context, eventType, streamKey string, payload map[string]interface{}) {
	from google_protobuf "google.golang.org/protobuf/types/known/structpb"
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
