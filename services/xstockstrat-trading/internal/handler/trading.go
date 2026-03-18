package handler

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	tradingv1connect "github.com/xstockstrat/contracts/gen/go/trading/v1/tradingv1connect"
	"github.com/xstockstrat/trading/internal/service"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Ensure TradingHandler implements the Connect interface at compile time.
var _ tradingv1connect.TradingServiceHandler = (*TradingHandler)(nil)

// TradingHandler implements the Connect-RPC TradingServiceHandler interface.
type TradingHandler struct {
	tradingv1connect.UnimplementedTradingServiceHandler
	svc *service.TradingService
}

func NewTradingHandler(svc *service.TradingService) *TradingHandler {
	return &TradingHandler{svc: svc}
}

func (h *TradingHandler) PlaceOrder(ctx context.Context, req *connect.Request[tradingv1.PlaceOrderRequest]) (*connect.Response[tradingv1.Order], error) {
	if req.Msg.Symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("symbol is required"))
	}
	if req.Msg.Qty <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("qty must be positive"))
	}
	order, err := h.svc.PlaceOrder(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(order), nil
}

func (h *TradingHandler) CancelOrder(ctx context.Context, req *connect.Request[tradingv1.CancelOrderRequest]) (*connect.Response[tradingv1.CancelOrderResponse], error) {
	if req.Msg.OrderId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("order_id is required"))
	}
	resp, err := h.svc.CancelOrder(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

func (h *TradingHandler) GetOrder(ctx context.Context, req *connect.Request[tradingv1.GetOrderRequest]) (*connect.Response[tradingv1.Order], error) {
	if req.Msg.OrderId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("order_id is required"))
	}
	order, err := h.svc.GetOrder(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(order), nil
}

func (h *TradingHandler) ListOrders(ctx context.Context, req *connect.Request[tradingv1.ListOrdersRequest]) (*connect.Response[tradingv1.ListOrdersResponse], error) {
	resp, err := h.svc.ListOrders(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

func (h *TradingHandler) StreamOrderUpdates(ctx context.Context, req *connect.Request[tradingv1.StreamOrderUpdatesRequest], stream *connect.ServerStream[tradingv1.Order]) error {
	subID := fmt.Sprintf("trading-%s-%p", req.Msg.UserId, stream)
	ch := h.svc.SubscribeOrderUpdates(subID)
	defer h.svc.UnsubscribeOrderUpdates(subID)

	for {
		select {
		case order, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(order); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// GRPCHandler returns a gRPC-compatible adapter around this handler.
func (h *TradingHandler) GRPCHandler() *grpcTradingAdapter {
	return &grpcTradingAdapter{h: h}
}

// grpcTradingAdapter wraps the Connect handler to implement tradingv1.TradingServiceServer.
type grpcTradingAdapter struct {
	tradingv1.UnimplementedTradingServiceServer
	h *TradingHandler
}

func (a *grpcTradingAdapter) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
	resp, err := a.h.PlaceOrder(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcTradingAdapter) CancelOrder(ctx context.Context, req *tradingv1.CancelOrderRequest) (*tradingv1.CancelOrderResponse, error) {
	resp, err := a.h.CancelOrder(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcTradingAdapter) GetOrder(ctx context.Context, req *tradingv1.GetOrderRequest) (*tradingv1.Order, error) {
	resp, err := a.h.GetOrder(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcTradingAdapter) ListOrders(ctx context.Context, req *tradingv1.ListOrdersRequest) (*tradingv1.ListOrdersResponse, error) {
	resp, err := a.h.ListOrders(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcTradingAdapter) StreamOrderUpdates(req *tradingv1.StreamOrderUpdatesRequest, grpcStream tradingv1.TradingService_StreamOrderUpdatesServer) error {
	subID := fmt.Sprintf("trading-%s-%p", req.UserId, grpcStream)
	ch := a.h.svc.SubscribeOrderUpdates(subID)
	defer a.h.svc.UnsubscribeOrderUpdates(subID)
	for {
		select {
		case order, ok := <-ch:
			if !ok {
				return nil
			}
			if err := grpcStream.Send(order); err != nil {
				return err
			}
		case <-grpcStream.Context().Done():
			return grpcStream.Context().Err()
		}
	}
}

func toGRPCError(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		switch connectErr.Code() {
		case connect.CodeInvalidArgument:
			return status.Error(codes.InvalidArgument, connectErr.Message())
		case connect.CodeNotFound:
			return status.Error(codes.NotFound, connectErr.Message())
		}
	}
	return status.Error(codes.Internal, err.Error())
}
