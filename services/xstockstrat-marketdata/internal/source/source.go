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

// MultiSymbolSource is an optional capability a DataSourceClient may also implement to
// fetch several symbols in one request. Callers type-assert to it and fall back to the
// per-symbol DataSourceClient methods when a source does not support batching, so adding
// this does not force every provider (or test fake) to implement it.
type MultiSymbolSource interface {
	GetBarsMulti(ctx context.Context, symbols []string, timeframe string, start, end time.Time) (map[string][]*marketdatav1.Bar, error)
	GetLatestQuotesMulti(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error)
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
