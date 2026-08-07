package service

import (
	"context"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/config"
)

// fakeSizingPortfolioClient overrides only ListPortfolios (the one method ComputePositionSize's
// equity lookup calls); every other method panics if exercised, since the real interface is
// embedded to satisfy the full portfoliov1.PortfolioServiceClient contract.
type fakeSizingPortfolioClient struct {
	portfoliov1.PortfolioServiceClient
	equity float64
}

func (f *fakeSizingPortfolioClient) ListPortfolios(_ context.Context, _ *portfoliov1.ListPortfoliosRequest, _ ...grpc.CallOption) (*portfoliov1.ListPortfoliosResponse, error) {
	return &portfoliov1.ListPortfoliosResponse{Portfolios: []*portfoliov1.Portfolio{{Equity: f.equity}}}, nil
}

// fakeMarketDataClient overrides only GetBars/GetLatestQuote — the two methods
// ComputePositionSize calls.
type fakeMarketDataClient struct {
	marketdatav1.MarketDataServiceClient
	bars  []*marketdatav1.Bar
	quote *marketdatav1.Quote
}

func (f *fakeMarketDataClient) GetBars(_ context.Context, _ *marketdatav1.GetBarsRequest, _ ...grpc.CallOption) (*marketdatav1.GetBarsResponse, error) {
	return &marketdatav1.GetBarsResponse{Bars: f.bars}, nil
}

func (f *fakeMarketDataClient) GetLatestQuote(_ context.Context, _ *marketdatav1.GetLatestQuoteRequest, _ ...grpc.CallOption) (*marketdatav1.Quote, error) {
	return f.quote, nil
}

// flatBars builds n synthetic daily bars with a constant high/low/close shape (High=101,
// Low=99, Close=100), so every day's Wilder true range is exactly 2.0 (|high-prevClose|=1 and
// |low-prevClose|=1 both stay under high-low=2) — yielding a hand-computable ATR(14) = 2.00
// exactly, matching product-spec.md's AC-1/AC-2 worked arithmetic.
func flatBars(n int) []*marketdatav1.Bar {
	bars := make([]*marketdatav1.Bar, n)
	for i := 0; i < n; i++ {
		bars[i] = &marketdatav1.Bar{Symbol: "TEST", High: 101, Low: 99, Close: 100}
	}
	return bars
}

// TestNewTradingService_MarketDataClientNonNil is a construction canary (feature 023): the new
// marketdata client field must always be non-nil after NewTradingService returns, matching the
// grpc.NewClient lazy-dial precedent in services/xstockstrat-marketdata/cmd/server/main_test.go.
func TestNewTradingService_MarketDataClientNonNil(t *testing.T) {
	cfg := &config.Config{
		LedgerEndpoint:     "localhost:0",
		NotifyEndpoint:     "localhost:0",
		PortfolioEndpoint:  "localhost:0",
		MarketDataEndpoint: "localhost:0",
	}
	svc, err := NewTradingService(cfg, &config.Watcher{}, nil, nil, nil, "")
	if err != nil {
		t.Fatalf("NewTradingService returned error: %v", err)
	}
	if svc.marketdata == nil {
		t.Fatal("svc.marketdata is nil; NewTradingService must always construct a marketdata client")
	}
}

// TestComputePositionSize_NormalCase is product-spec.md AC-1's exact worked arithmetic:
// equity=10000, max_risk_pct=0.02 (code default), atr_multiplier=1.5 (code default), ATR=2.00,
// confidence=1.0 → floor((10000*0.02*1.0)/(1.5*2.0)) = 66 shares. Uses a low current price
// ($10) so the concentration cap (AC-2) is not triggered here.
func TestComputePositionSize_NormalCase(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 10000},
		marketdata: &fakeMarketDataClient{bars: flatBars(15), quote: &marketdatav1.Quote{AskPrice: 10, BidPrice: 10}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	qty, _, _, err := svc.ComputePositionSize(context.Background(), req, 10000, 1.0)
	if err != nil {
		t.Fatalf("ComputePositionSize returned error: %v", err)
	}
	if qty != 66 {
		t.Fatalf("qty = %v, want 66", qty)
	}
}

// TestComputePositionSize_ConcentrationCapTriggered is AC-2's exact worked arithmetic: the raw
// 66-share result at a $200 current price ($13,200, 132% of equity) is reduced to
// floor(10000*0.10/200) = 5 shares.
func TestComputePositionSize_ConcentrationCapTriggered(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 10000},
		marketdata: &fakeMarketDataClient{bars: flatBars(15), quote: &marketdatav1.Quote{AskPrice: 200, BidPrice: 200}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	qty, _, _, err := svc.ComputePositionSize(context.Background(), req, 10000, 1.0)
	if err != nil {
		t.Fatalf("ComputePositionSize returned error: %v", err)
	}
	if qty != 5 {
		t.Fatalf("qty = %v, want 5", qty)
	}
}

// TestComputePositionSize_ConfidenceHalfScaling is product-spec.md AC-7's confidence=0.5 case:
// same inputs as AC-1 with confidence=0.5 → floor((10000*0.02*0.5)/3.0) = floor(100/3.0) = 33
// (exactly half of AC-1's 66, floor-consistent with the linear confidence formula).
func TestComputePositionSize_ConfidenceHalfScaling(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 10000},
		marketdata: &fakeMarketDataClient{bars: flatBars(15), quote: &marketdatav1.Quote{AskPrice: 10, BidPrice: 10}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	qty, _, _, err := svc.ComputePositionSize(context.Background(), req, 10000, 0.5)
	if err != nil {
		t.Fatalf("ComputePositionSize returned error: %v", err)
	}
	if qty != 33 {
		t.Fatalf("qty = %v, want 33", qty)
	}
}

func TestComputePositionSize_InsufficientBars(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 10000},
		marketdata: &fakeMarketDataClient{bars: flatBars(10), quote: &marketdatav1.Quote{AskPrice: 10, BidPrice: 10}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	_, _, _, err := svc.ComputePositionSize(context.Background(), req, 10000, 1.0)
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
}

// TestComputePositionSize_ZeroEquity confirms fail-closed behavior: zero equity errors rather
// than sizing to a zero-quantity result. PlaceOrder already fail-closes on equity<=0 before
// ever calling ComputePositionSize, but ComputePositionSize guards it too (a public method
// other callers could invoke directly) — this test exercises that inner guard.
func TestComputePositionSize_ZeroEquity(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 0},
		marketdata: &fakeMarketDataClient{bars: flatBars(15), quote: &marketdatav1.Quote{AskPrice: 10, BidPrice: 10}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	_, _, _, err := svc.ComputePositionSize(context.Background(), req, 0, 1.0)
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
}

func TestComputePositionSize_ZeroQuote(t *testing.T) {
	svc := &TradingService{
		cfgW:       &config.Watcher{},
		portfolio:  &fakeSizingPortfolioClient{equity: 10000},
		marketdata: &fakeMarketDataClient{bars: flatBars(15), quote: &marketdatav1.Quote{AskPrice: 0, BidPrice: 0}},
	}
	req := &tradingv1.PlaceOrderRequest{Symbol: "TEST", Side: tradingv1.OrderSide_ORDER_SIDE_BUY}
	_, _, _, err := svc.ComputePositionSize(context.Background(), req, 10000, 1.0)
	if grpcstatus.Code(err) != codes.FailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
}

func TestWilderATR_KnownSeries(t *testing.T) {
	atr, err := wilderATR(flatBars(15), 14)
	if err != nil {
		t.Fatalf("wilderATR returned error: %v", err)
	}
	if atr != 2.0 {
		t.Fatalf("atr = %v, want 2.0", atr)
	}
}

func TestWilderATR_InsufficientBars(t *testing.T) {
	_, err := wilderATR(flatBars(10), 14)
	if err == nil {
		t.Fatal("expected an error for insufficient bars, got nil")
	}
}
