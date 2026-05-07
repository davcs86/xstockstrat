package handler

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	portfoliov1connect "github.com/xstockstrat/contracts/gen/go/portfolio/v1/portfoliov1connect"
	"github.com/xstockstrat/portfolio/internal/service"
)

// Ensure PortfolioHandler implements the Connect interface at compile time.
var _ portfoliov1connect.PortfolioServiceHandler = (*PortfolioHandler)(nil)

// PortfolioHandler implements the Connect-RPC PortfolioServiceHandler interface.
type PortfolioHandler struct {
	portfoliov1connect.UnimplementedPortfolioServiceHandler
	svc *service.PortfolioService
}

// NewPortfolioHandler constructs the handler.
func NewPortfolioHandler(svc *service.PortfolioService) *PortfolioHandler {
	return &PortfolioHandler{svc: svc}
}

// GetPortfolio returns the full portfolio with positions and live prices.
func (h *PortfolioHandler) GetPortfolio(ctx context.Context, req *connect.Request[portfoliov1.GetPortfolioRequest]) (*connect.Response[portfoliov1.Portfolio], error) {
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("user_id required"))
	}
	p, err := h.svc.GetPortfolio(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(p), nil
}

// GetPosition returns a single position with live price.
func (h *PortfolioHandler) GetPosition(ctx context.Context, req *connect.Request[portfoliov1.GetPositionRequest]) (*connect.Response[portfoliov1.Position], error) {
	if req.Msg.UserId == "" || req.Msg.Symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("user_id and symbol required"))
	}
	p, err := h.svc.GetPosition(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(p), nil
}

// ListPositions returns paginated positions for a user.
func (h *PortfolioHandler) ListPositions(ctx context.Context, req *connect.Request[portfoliov1.ListPositionsRequest]) (*connect.Response[portfoliov1.ListPositionsResponse], error) {
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("user_id required"))
	}
	resp, err := h.svc.ListPositions(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

// GetPnL returns P&L summary for a user over a time range.
func (h *PortfolioHandler) GetPnL(ctx context.Context, req *connect.Request[portfoliov1.GetPnLRequest]) (*connect.Response[portfoliov1.PnLResponse], error) {
	if req.Msg.UserId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("user_id required"))
	}
	resp, err := h.svc.GetPnL(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

// GetSnapshot retrieves a historical portfolio snapshot.
func (h *PortfolioHandler) GetSnapshot(ctx context.Context, req *connect.Request[portfoliov1.GetSnapshotRequest]) (*connect.Response[portfoliov1.PortfolioSnapshot], error) {
	if req.Msg.PortfolioId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("portfolio_id required"))
	}
	snap, err := h.svc.GetSnapshot(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(snap), nil
}

// StreamPortfolioUpdates pushes portfolio snapshots as they occur.
func (h *PortfolioHandler) StreamPortfolioUpdates(ctx context.Context, req *connect.Request[portfoliov1.StreamPortfolioUpdatesRequest], stream *connect.ServerStream[portfoliov1.PortfolioSnapshot]) error {
	if req.Msg.UserId == "" {
		return connect.NewError(connect.CodeInvalidArgument, errorf("user_id required"))
	}
	subID := fmt.Sprintf("portfolio-%s-%p", req.Msg.UserId, stream)
	ch := h.svc.Subscribe(subID)
	defer h.svc.Unsubscribe(subID)

	for {
		select {
		case snap, ok := <-ch:
			if !ok {
				return nil
			}
			if req.Msg.TradingMode != 0 && snap.TradingMode != req.Msg.TradingMode {
				continue
			}
			if err := stream.Send(snap); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// ListPortfolios returns portfolios grouped by broker account.
func (h *PortfolioHandler) ListPortfolios(ctx context.Context, req *connect.Request[portfoliov1.ListPortfoliosRequest]) (*connect.Response[portfoliov1.ListPortfoliosResponse], error) {
	resp, err := h.svc.ListPortfolios(ctx, req.Msg)
	if err != nil {
		return nil, toGRPCError(err)
	}
	return connect.NewResponse(resp), nil
}

// GRPCHandler returns a gRPC-compatible adapter around this handler.
func (h *PortfolioHandler) GRPCHandler() *grpcPortfolioAdapter {
	return &grpcPortfolioAdapter{h: h}
}

// grpcPortfolioAdapter wraps the Connect handler to implement portfoliov1.PortfolioServiceServer.
type grpcPortfolioAdapter struct {
	portfoliov1.UnimplementedPortfolioServiceServer
	h *PortfolioHandler
}

func (a *grpcPortfolioAdapter) GetPortfolio(ctx context.Context, req *portfoliov1.GetPortfolioRequest) (*portfoliov1.Portfolio, error) {
	resp, err := a.h.GetPortfolio(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcPortfolioAdapter) GetPosition(ctx context.Context, req *portfoliov1.GetPositionRequest) (*portfoliov1.Position, error) {
	resp, err := a.h.GetPosition(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcPortfolioAdapter) ListPositions(ctx context.Context, req *portfoliov1.ListPositionsRequest) (*portfoliov1.ListPositionsResponse, error) {
	resp, err := a.h.ListPositions(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcPortfolioAdapter) GetPnL(ctx context.Context, req *portfoliov1.GetPnLRequest) (*portfoliov1.PnLResponse, error) {
	resp, err := a.h.GetPnL(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcPortfolioAdapter) GetSnapshot(ctx context.Context, req *portfoliov1.GetSnapshotRequest) (*portfoliov1.PortfolioSnapshot, error) {
	resp, err := a.h.GetSnapshot(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcPortfolioAdapter) StreamPortfolioUpdates(req *portfoliov1.StreamPortfolioUpdatesRequest, grpcStream portfoliov1.PortfolioService_StreamPortfolioUpdatesServer) error {
	subID := fmt.Sprintf("portfolio-%s-%p", req.UserId, grpcStream)
	ch := a.h.svc.Subscribe(subID)
	defer a.h.svc.Unsubscribe(subID)
	for {
		select {
		case snap, ok := <-ch:
			if !ok {
				return nil
			}
			if req.TradingMode != 0 && snap.TradingMode != req.TradingMode {
				continue
			}
			if err := grpcStream.Send(snap); err != nil {
				return err
			}
		case <-grpcStream.Context().Done():
			return grpcStream.Context().Err()
		}
	}
}

func (a *grpcPortfolioAdapter) ListPortfolios(ctx context.Context, req *portfoliov1.ListPortfoliosRequest) (*portfoliov1.ListPortfoliosResponse, error) {
	resp, err := a.h.ListPortfolios(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func errorf(msg string) error {
	return fmt.Errorf("%s", msg)
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
