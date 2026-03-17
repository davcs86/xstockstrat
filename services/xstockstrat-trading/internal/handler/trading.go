package handler

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/service"
)

type TradingHandler struct {
	tradingv1.UnimplementedTradingServiceServer
	svc *service.TradingService
}

func NewTradingHandler(svc *service.TradingService) *TradingHandler {
	return &TradingHandler{svc: svc}
}

func (h *TradingHandler) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
	if req.Symbol == "" {
		return nil, status.Error(codes.InvalidArgument, "symbol is required")
	}
	if req.Qty <= 0 {
		return nil, status.Error(codes.InvalidArgument, "qty must be positive")
	}
	return h.svc.PlaceOrder(ctx, req)
}

func (h *TradingHandler) CancelOrder(ctx context.Context, req *tradingv1.CancelOrderRequest) (*tradingv1.CancelOrderResponse, error) {
	if req.OrderId == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id is required")
	}
	return h.svc.CancelOrder(ctx, req)
}

func (h *TradingHandler) GetOrder(ctx context.Context, req *tradingv1.GetOrderRequest) (*tradingv1.Order, error) {
	if req.OrderId == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id is required")
	}
	return h.svc.GetOrder(ctx, req)
}

func (h *TradingHandler) ListOrders(ctx context.Context, req *tradingv1.ListOrdersRequest) (*tradingv1.ListOrdersResponse, error) {
	return h.svc.ListOrders(ctx, req)
}

func (h *TradingHandler) StreamOrderUpdates(req *tradingv1.StreamOrderUpdatesRequest, stream tradingv1.TradingService_StreamOrderUpdatesServer) error {
	return h.svc.StreamOrderUpdates(req, stream)
}
