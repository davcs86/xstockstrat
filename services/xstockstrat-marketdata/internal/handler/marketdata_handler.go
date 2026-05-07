package handler

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	marketdatav1connect "github.com/xstockstrat/contracts/gen/go/marketdata/v1/marketdatav1connect"
	"github.com/xstockstrat/marketdata/internal/service"
)

// Ensure MarketDataHandler implements both interfaces at compile time.
var _ marketdatav1connect.MarketDataServiceHandler = (*MarketDataHandler)(nil)

// MarketDataHandler implements both the Connect-RPC and gRPC service interfaces.
// Connect-RPC (HTTP) and gRPC share the same handler via the Connect framework which
// supports gRPC protocol natively over HTTP/2.
type MarketDataHandler struct {
	marketdatav1connect.UnimplementedMarketDataServiceHandler
	svc *service.MarketDataService
}

// NewMarketDataHandler constructs the handler.
func NewMarketDataHandler(svc *service.MarketDataService) *MarketDataHandler {
	return &MarketDataHandler{svc: svc}
}

// StreamBars starts the Alpaca bar feed and streams bars to the Connect client.
func (h *MarketDataHandler) StreamBars(ctx context.Context, req *connect.Request[marketdatav1.StreamBarsRequest], stream *connect.ServerStream[marketdatav1.Bar]) error {
	if len(req.Msg.Symbols) == 0 {
		return connect.NewError(connect.CodeInvalidArgument, errorf("symbols required"))
	}
	subID := keyFor(stream)
	ch := h.svc.SubscribeBars(subID)
	defer h.svc.UnsubscribeBars(subID)

	go h.svc.StartBarStream(ctx, req.Msg.Symbols, req.Msg.Timeframe)

	for {
		select {
		case bar, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(bar); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// StreamQuotes starts the Alpaca quote feed and streams quotes.
func (h *MarketDataHandler) StreamQuotes(ctx context.Context, req *connect.Request[marketdatav1.StreamQuotesRequest], stream *connect.ServerStream[marketdatav1.Quote]) error {
	if len(req.Msg.Symbols) == 0 {
		return connect.NewError(connect.CodeInvalidArgument, errorf("symbols required"))
	}
	subID := keyFor(stream)
	ch := h.svc.SubscribeQuotes(subID)
	defer h.svc.UnsubscribeQuotes(subID)

	go h.svc.StartQuoteStream(ctx, req.Msg.Symbols)

	for {
		select {
		case q, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(q); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// GetBars returns historical OHLCV bars.
func (h *MarketDataHandler) GetBars(ctx context.Context, req *connect.Request[marketdatav1.GetBarsRequest]) (*connect.Response[marketdatav1.GetBarsResponse], error) {
	if req.Msg.Symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("symbol required"))
	}
	resp, err := h.svc.GetBars(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

// GetLatestQuote returns the most recent NBBO quote.
func (h *MarketDataHandler) GetLatestQuote(ctx context.Context, req *connect.Request[marketdatav1.GetLatestQuoteRequest]) (*connect.Response[marketdatav1.Quote], error) {
	if req.Msg.Symbol == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("symbol required"))
	}
	q, err := h.svc.GetLatestQuote(ctx, req.Msg.Symbol)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(q), nil
}

// BackfillBars triggers a historical backfill from Alpaca.
func (h *MarketDataHandler) BackfillBars(ctx context.Context, req *connect.Request[marketdatav1.BackfillBarsRequest]) (*connect.Response[marketdatav1.BackfillBarsResponse], error) {
	if len(req.Msg.Symbols) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errorf("symbols required"))
	}
	resp, err := h.svc.BackfillBars(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

// ListAssets returns all tradable assets from Alpaca.
func (h *MarketDataHandler) ListAssets(ctx context.Context, req *connect.Request[marketdatav1.ListAssetsRequest]) (*connect.Response[marketdatav1.ListAssetsResponse], error) {
	resp, err := h.svc.ListAssets(ctx, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(resp), nil
}

// GRPCHandler returns a gRPC-compatible adapter around this handler.
// Used for the native gRPC server registration.
func (h *MarketDataHandler) GRPCHandler() *grpcMarketDataAdapter {
	return &grpcMarketDataAdapter{h: h}
}

// grpcMarketDataAdapter wraps the Connect handler to implement marketdatav1.MarketDataServiceServer.
type grpcMarketDataAdapter struct {
	marketdatav1.UnimplementedMarketDataServiceServer
	h *MarketDataHandler
}

func (a *grpcMarketDataAdapter) GetBars(ctx context.Context, req *marketdatav1.GetBarsRequest) (*marketdatav1.GetBarsResponse, error) {
	resp, err := a.h.GetBars(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcMarketDataAdapter) GetLatestQuote(ctx context.Context, req *marketdatav1.GetLatestQuoteRequest) (*marketdatav1.Quote, error) {
	resp, err := a.h.GetLatestQuote(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcMarketDataAdapter) BackfillBars(ctx context.Context, req *marketdatav1.BackfillBarsRequest) (*marketdatav1.BackfillBarsResponse, error) {
	resp, err := a.h.BackfillBars(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcMarketDataAdapter) ListAssets(ctx context.Context, req *marketdatav1.ListAssetsRequest) (*marketdatav1.ListAssetsResponse, error) {
	resp, err := a.h.ListAssets(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, toGRPCError(err)
	}
	return resp.Msg, nil
}

func (a *grpcMarketDataAdapter) StreamBars(req *marketdatav1.StreamBarsRequest, grpcStream marketdatav1.MarketDataService_StreamBarsServer) error {
	subID := keyFor(grpcStream)
	ch := a.h.svc.SubscribeBars(subID)
	defer a.h.svc.UnsubscribeBars(subID)
	go a.h.svc.StartBarStream(grpcStream.Context(), req.Symbols, req.Timeframe)
	for {
		select {
		case bar, ok := <-ch:
			if !ok {
				return nil
			}
			if err := grpcStream.Send(bar); err != nil {
				return err
			}
		case <-grpcStream.Context().Done():
			return grpcStream.Context().Err()
		}
	}
}

func (a *grpcMarketDataAdapter) StreamQuotes(req *marketdatav1.StreamQuotesRequest, grpcStream marketdatav1.MarketDataService_StreamQuotesServer) error {
	subID := keyFor(grpcStream)
	ch := a.h.svc.SubscribeQuotes(subID)
	defer a.h.svc.UnsubscribeQuotes(subID)
	go a.h.svc.StartQuoteStream(grpcStream.Context(), req.Symbols)
	for {
		select {
		case q, ok := <-ch:
			if !ok {
				return nil
			}
			if err := grpcStream.Send(q); err != nil {
				return err
			}
		case <-grpcStream.Context().Done():
			return grpcStream.Context().Err()
		}
	}
}

func keyFor(v interface{}) string {
	return fmt.Sprintf("%p", v)
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
