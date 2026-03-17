package alpaca

import (
	"context"
	"fmt"
	"time"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ClientConfig holds Alpaca API credentials.
// xstockstrat-marketdata is the ONLY service that imports or uses this package.
type ClientConfig struct {
	APIKey    string
	APISecret string
	BaseURL   string // e.g. https://paper-api.alpaca.markets
	DataURL   string // e.g. https://data.alpaca.markets
	Paper     bool
}

// Client wraps Alpaca REST + streaming APIs.
// Replace stub implementations with alpaca-trade-api-go or equivalent.
type Client struct {
	cfg ClientConfig
}

func NewClient(cfg ClientConfig) *Client {
	return &Client{cfg: cfg}
}

// GetBars fetches historical OHLCV bars from Alpaca.
func (c *Client) GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]*marketdatav1.Bar, error) {
	// TODO: implement using Alpaca v2 bars API
	// GET /v2/stocks/{symbol}/bars?timeframe=1Min&start=...&end=...
	_ = fmt.Sprintf("%s/v2/stocks/%s/bars", c.cfg.DataURL, symbol)
	return nil, fmt.Errorf("not implemented: replace with alpaca-trade-api-go")
}

// GetLatestQuote fetches the latest NBBO quote.
func (c *Client) GetLatestQuote(ctx context.Context, symbol string) (*marketdatav1.Quote, error) {
	// TODO: GET /v2/stocks/{symbol}/quotes/latest
	return nil, fmt.Errorf("not implemented")
}

// StreamBars opens a WebSocket data stream for real-time bar updates.
// Returns a channel of bars and a cancel function.
func (c *Client) StreamBars(ctx context.Context, symbols []string, timeframe string) (<-chan *marketdatav1.Bar, error) {
	ch := make(chan *marketdatav1.Bar, 256)
	// TODO: implement Alpaca WebSocket stream via wss://stream.data.alpaca.markets/v2/iex
	// Use ctx for cancellation
	go func() {
		defer close(ch)
		// stub: emit a single synthetic bar for each symbol, then block
		for _, sym := range symbols {
			ch <- &marketdatav1.Bar{
				Symbol:    sym,
				Time:      timestamppb.Now(),
				Open:      100.0,
				High:      101.0,
				Low:       99.5,
				Close:     100.5,
				Volume:    10000,
				Timeframe: timeframe,
				Source:    "alpaca",
			}
		}
		<-ctx.Done()
	}()
	return ch, nil
}

// ListAssets returns all tradable assets from Alpaca.
func (c *Client) ListAssets(ctx context.Context, assetClass string) ([]AlpacaAsset, error) {
	// TODO: GET /v2/assets?status=active&asset_class=us_equity
	return nil, fmt.Errorf("not implemented")
}

type AlpacaAsset struct {
	Symbol      string
	Name        string
	Exchange    string
	AssetClass  string
	Tradable    bool
	Fractionable bool
}
