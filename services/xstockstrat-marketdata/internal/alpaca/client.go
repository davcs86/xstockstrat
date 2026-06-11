// Package alpaca provides the sole Alpaca Markets API integration for xstockstrat.
// xstockstrat-marketdata is the ONLY service that imports or uses this package.
package alpaca

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// ClientConfig holds Alpaca API credentials.
// xstockstrat-marketdata is the ONLY service that imports or uses this package.
type ClientConfig struct {
	APIKey    string
	APISecret string
	BaseURL   string // e.g. https://paper-api.alpaca.markets
	DataURL   string // e.g. https://data.alpaca.markets
	// Feed selects the Alpaca market-data feed for bar/quote requests
	// ("iex" | "sip" | "otc"). The free/basic (paper) data plan only permits
	// "iex"; omitting feed defaults Alpaca to SIP, which those plans reject
	// with HTTP 403. Empty falls back to "iex" via feedParam().
	Feed  string
	Paper bool
}

// Client wraps Alpaca REST and streaming APIs.
type Client struct {
	cfg        ClientConfig
	httpClient *http.Client
}

// NewClient returns a new Alpaca client.
func NewClient(cfg ClientConfig) *Client {
	return &Client{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// feedParam returns the configured market-data feed, defaulting to "iex" so the
// free/basic data plan works without explicit configuration.
func (c *Client) feedParam() string {
	if c.cfg.Feed == "" {
		return "iex"
	}
	return c.cfg.Feed
}

// alpacaBar is the JSON shape returned by Alpaca v2 bars endpoint.
type alpacaBar struct {
	T  string  `json:"t"`
	O  float64 `json:"o"`
	H  float64 `json:"h"`
	L  float64 `json:"l"`
	C  float64 `json:"c"`
	V  int64   `json:"v"`
	VW float64 `json:"vw"`
	N  int32   `json:"n"`
}

type alpacaBarsResponse struct {
	Bars          []alpacaBar `json:"bars"`
	Symbol        string      `json:"symbol"`
	NextPageToken string      `json:"next_page_token"`
}

// GetBars fetches historical OHLCV bars from Alpaca v2 REST API.
func (c *Client) GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]*marketdatav1.Bar, error) {
	baseURL := fmt.Sprintf("%s/v2/stocks/%s/bars?timeframe=%s&feed=%s&start=%s&end=%s&limit=1000",
		c.cfg.DataURL, symbol, timeframe, c.feedParam(),
		start.UTC().Format(time.RFC3339),
		end.UTC().Format(time.RFC3339),
	)

	var allBars []*marketdatav1.Bar
	url := baseURL
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		req.Header.Set("APCA-API-KEY-ID", c.cfg.APIKey)
		req.Header.Set("APCA-API-SECRET-KEY", c.cfg.APISecret)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("get bars: %w", err)
		}
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("alpaca bars %d: %s", resp.StatusCode, string(body))
		}

		var result alpacaBarsResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("unmarshal bars: %w", err)
		}
		for _, b := range result.Bars {
			t, err := time.Parse(time.RFC3339, b.T)
			if err != nil {
				continue
			}
			allBars = append(allBars, &marketdatav1.Bar{
				Symbol: symbol, Time: timestamppb.New(t),
				Open: b.O, High: b.H, Low: b.L, Close: b.C,
				Volume: b.V, Vwap: b.VW, TradeCount: b.N,
				Timeframe: timeframe, Source: "alpaca",
			})
		}
		if result.NextPageToken == "" {
			break
		}
		url = baseURL + "&page_token=" + result.NextPageToken
	}
	return allBars, nil
}

type alpacaLatestQuoteResponse struct {
	Quote struct {
		T  string  `json:"t"`
		AP float64 `json:"ap"`
		AS int32   `json:"as"`
		BP float64 `json:"bp"`
		BS int32   `json:"bs"`
	} `json:"quote"`
}

// GetLatestQuote fetches the most recent NBBO quote from Alpaca.
func (c *Client) GetLatestQuote(ctx context.Context, symbol string) (*marketdatav1.Quote, error) {
	url := fmt.Sprintf("%s/v2/stocks/%s/quotes/latest?feed=%s", c.cfg.DataURL, symbol, c.feedParam())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("APCA-API-KEY-ID", c.cfg.APIKey)
	req.Header.Set("APCA-API-SECRET-KEY", c.cfg.APISecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get latest quote: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca quote %d: %s", resp.StatusCode, string(body))
	}
	var result alpacaLatestQuoteResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal quote: %w", err)
	}
	q := result.Quote
	t, _ := time.Parse(time.RFC3339, q.T)
	return &marketdatav1.Quote{
		Symbol: symbol, Time: timestamppb.New(t),
		AskPrice: q.AP, AskSize: q.AS,
		BidPrice: q.BP, BidSize: q.BS,
		Source: "alpaca",
	}, nil
}

// StreamBars opens a real-time bar channel backed by a polling loop.
// For production, replace with Alpaca WebSocket (wss://stream.data.alpaca.markets/v2/{feed}).
func (c *Client) StreamBars(ctx context.Context, symbols []string, timeframe string) (<-chan *marketdatav1.Bar, error) {
	ch := make(chan *marketdatav1.Bar, 256)
	go func() {
		defer close(ch)
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				end := time.Now().UTC()
				start := end.Add(-2 * time.Minute)
				for _, sym := range symbols {
					bars, err := c.GetBars(ctx, sym, timeframe, start, end)
					if err != nil {
						continue
					}
					for _, b := range bars {
						select {
						case ch <- b:
						case <-ctx.Done():
							return
						}
					}
				}
			}
		}
	}()
	return ch, nil
}

// StreamQuotes opens a real-time quote channel backed by a polling loop.
// For production, replace with Alpaca WebSocket.
func (c *Client) StreamQuotes(ctx context.Context, symbols []string) (<-chan *marketdatav1.Quote, error) {
	ch := make(chan *marketdatav1.Quote, 256)
	go func() {
		defer close(ch)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for _, sym := range symbols {
					q, err := c.GetLatestQuote(ctx, sym)
					if err != nil {
						continue
					}
					select {
					case ch <- q:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}()
	return ch, nil
}

type alpacaAssetJSON struct {
	Symbol   string `json:"symbol"`
	Exchange string `json:"exchange"`
	Class    string `json:"class"`
	Tradable bool   `json:"tradable"`
}

// ListAssets returns all tradable assets from Alpaca.
func (c *Client) ListAssets(ctx context.Context, assetClass string) ([]*commonv1.Asset, error) {
	url := fmt.Sprintf("%s/v2/assets?status=active", c.cfg.BaseURL)
	if assetClass != "" {
		url += "&asset_class=" + assetClass
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("APCA-API-KEY-ID", c.cfg.APIKey)
	req.Header.Set("APCA-API-SECRET-KEY", c.cfg.APISecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list assets: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca assets %d: %s", resp.StatusCode, string(body))
	}
	var raw []alpacaAssetJSON
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal assets: %w", err)
	}
	assets := make([]*commonv1.Asset, 0, len(raw))
	for _, a := range raw {
		if !a.Tradable {
			continue
		}
		assets = append(assets, &commonv1.Asset{
			Symbol:     a.Symbol,
			Exchange:   a.Exchange,
			AssetClass: a.Class,
		})
	}
	return assets, nil
}

// AlpacaAsset is kept for backward compatibility.
type AlpacaAsset struct {
	Symbol       string
	Name         string
	Exchange     string
	AssetClass   string
	Tradable     bool
	Fractionable bool
}
