package source

import (
	"context"
	"fmt"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// DataSourceClient is the interface all market data providers must satisfy.
// Add a new provider by implementing this interface and calling Registry.Register.
type DataSourceClient interface {
	GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]*marketdatav1.Bar, error)
	GetLatestQuote(ctx context.Context, symbol string) (*marketdatav1.Quote, error)
	ListAssets(ctx context.Context, assetClass string) ([]*commonv1.Asset, error)
	StreamBars(ctx context.Context, symbols []string, timeframe string) (<-chan *marketdatav1.Bar, error)
	StreamQuotes(ctx context.Context, symbols []string) (<-chan *marketdatav1.Quote, error)
}

// MultiSymbolSource is an optional capability to fetch several symbols in one request. Callers
// type-assert and fall back to per-symbol methods, so a source need not implement it.
type MultiSymbolSource interface {
	GetBarsMulti(ctx context.Context, symbols []string, timeframe string, start, end time.Time) (map[string][]*marketdatav1.Bar, error)
	GetLatestQuotesMulti(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error)
}

// LatestTradeSource is an optional capability to fetch the most recent trade price + timestamp.
// Callers type-assert and degrade gracefully, so a source need not implement it.
type LatestTradeSource interface {
	GetLatestTrade(ctx context.Context, symbol string) (price float64, tradeTime time.Time, err error)
}

// Fundamentals is the provider-agnostic fundamental-metrics model. The metric fields are
// *float64: nil means the provider did not supply it (distinct from a real 0.0) — never default to 0.
type Fundamentals struct {
	Symbol        string
	MarketCap     *float64
	PERatio       *float64
	PBRatio       *float64
	DividendYield *float64
	EPS           *float64
	Beta          *float64
	ROE           *float64
	DebtToEquity  *float64
	Price         *float64
	YearHigh      *float64
	YearLow       *float64
	ExtraMetrics  map[string]float64
	AsOf          time.Time
	Currency      string
	Source        string
}

// FundamentalsSource fetches fundamental metrics for symbols. Separate from DataSourceClient
// (OHLCV) and never registered in the OHLCV Registry (FR-2); held as its own service field.
type FundamentalsSource interface {
	GetFundamentals(ctx context.Context, symbol string) (*Fundamentals, error)
	GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*Fundamentals, error)
}

// Registry maps named source slugs to DataSourceClient implementations.
// The default source is "alpaca"; pass an empty string to Get to use it.
type Registry struct {
	sources map[string]DataSourceClient
}

// NewRegistry creates an empty Registry.
func NewRegistry() *Registry {
	return &Registry{sources: make(map[string]DataSourceClient)}
}

// Register adds a named source. Panics on duplicate registration.
func (r *Registry) Register(name string, client DataSourceClient) {
	if _, exists := r.sources[name]; exists {
		panic(fmt.Sprintf("source %q already registered", name))
	}
	r.sources[name] = client
}

// Get returns the named source, falling back to "alpaca" when name is empty.
func (r *Registry) Get(name string) (DataSourceClient, error) {
	if name == "" {
		name = "alpaca"
	}
	c, ok := r.sources[name]
	if !ok {
		return nil, fmt.Errorf("unknown data source %q", name)
	}
	return c, nil
}
