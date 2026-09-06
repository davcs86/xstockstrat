// Package alpaca provides the sole Alpaca Markets API integration for xstockstrat.
// xstockstrat-marketdata is the ONLY service that imports or uses this package.
package alpaca

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	tfpkg "github.com/xstockstrat/marketdata/internal/timeframe"
)

// maxBarsLimit is the largest page size Alpaca's bars endpoint accepts (spec maximum).
const maxBarsLimit = 10000

// ClientConfig holds Alpaca API credentials.
type ClientConfig struct {
	APIKey    string
	APISecret string
	BaseURL   string // e.g. https://paper-api.alpaca.markets
	DataURL   string // e.g. https://data.alpaca.markets
	// Feed selects the market-data feed ("iex"|"sip"|"otc"). Empty → "iex": the free/basic
	// paper plan permits only "iex" and rejects Alpaca's SIP default with HTTP 403.
	Feed string
	// BatchSize is the bars-per-request limit (marketdata.backfill.batch_size).
	// Clamped to Alpaca's spec maximum (10000); zero/negative falls back to the max.
	BatchSize int
	// RateLimitRPS caps outbound REST calls per second (marketdata.backfill.rate_limit_rps).
	// Zero/negative disables rate limiting.
	RateLimitRPS int
	// Adjustment applied to historical bars ("raw"|"split"|"dividend"|"all"); default "all"
	// so splits/dividends do not distort backtest OHLCV. From marketdata.alpaca.adjustment.
	Adjustment string
	// ReconnectDelayMs / MaxReconnects govern the streaming WebSocket reconnect loop
	// (marketdata.stream.reconnect_delay_ms / marketdata.stream.max_reconnects).
	ReconnectDelayMs int
	MaxReconnects    int
	Paper            bool
}

// Client wraps Alpaca REST and streaming APIs.
type Client struct {
	cfg        ClientConfig
	httpClient *http.Client
	limiter    *rate.Limiter

	streamOnce sync.Once
	stream     *streamManager
}

// NewClient returns a new Alpaca client.
func NewClient(cfg ClientConfig) *Client {
	if cfg.BatchSize <= 0 || cfg.BatchSize > maxBarsLimit {
		cfg.BatchSize = maxBarsLimit
	}
	if cfg.Adjustment == "" {
		cfg.Adjustment = "all"
	}
	var limiter *rate.Limiter
	if cfg.RateLimitRPS > 0 {
		limiter = rate.NewLimiter(rate.Limit(cfg.RateLimitRPS), cfg.RateLimitRPS)
	}
	return &Client{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		limiter:    limiter,
	}
}

// do sets auth headers, waits on the rate limiter (if configured), and executes the
// request. Centralizing this keeps every REST call rate-limited and authenticated.
func (c *Client) do(req *http.Request) (*http.Response, error) {
	req.Header.Set("APCA-API-KEY-ID", c.cfg.APIKey)
	req.Header.Set("APCA-API-SECRET-KEY", c.cfg.APISecret)
	if c.limiter != nil {
		if err := c.limiter.Wait(req.Context()); err != nil {
			return nil, fmt.Errorf("rate limiter: %w", err)
		}
	}
	return c.httpClient.Do(req)
}

// feedParam returns the configured feed, defaulting to "iex" (free-plan requirement).
func (c *Client) feedParam() string {
	if c.cfg.Feed == "" {
		return "iex"
	}
	return c.cfg.Feed
}

// alpacaTimeframe maps canonical interval strings (15m/1h/1d) to Alpaca's v2 spellings
// (15Min/1Hour/1Day); Alpaca rejects the canonical forms with HTTP 400. Unknowns pass through.
func alpacaTimeframe(tf string) string {
	switch tf {
	case "15m", "15Min":
		return "15Min"
	case "1h", "1Hour":
		return "1Hour"
	case "1d", "1Day":
		return "1Day"
	default:
		return tf
	}
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

// barFromAlpaca maps one Alpaca bar to a proto Bar. Shared by the single- and multi-symbol
// paths so the deprecated string timeframe and its enum are set in exactly one place.
func barFromAlpaca(symbol string, b alpacaBar, t time.Time, timeframe string) *marketdatav1.Bar {
	return &marketdatav1.Bar{
		Symbol: symbol, Time: timestamppb.New(t),
		Open: b.O, High: b.H, Low: b.L, Close: b.C,
		Volume: b.V, Vwap: b.VW, TradeCount: b.N,
		Timeframe: timeframe, Source: "alpaca", //nolint:staticcheck // SA1019: deprecated string timeframe written during the one-release deprecation window (053)
		TimeframeEnum: tfpkg.FromString(timeframe),
	}
}

// adjustmentParam returns the configured adjustment, defaulting to "all" even without NewClient.
func (c *Client) adjustmentParam() string {
	if c.cfg.Adjustment == "" {
		return "all"
	}
	return c.cfg.Adjustment
}

// barsLimit returns the configured per-request bar limit, clamped to the spec maximum.
func (c *Client) barsLimit() int {
	if c.cfg.BatchSize <= 0 || c.cfg.BatchSize > maxBarsLimit {
		return maxBarsLimit
	}
	return c.cfg.BatchSize
}

// GetBars fetches historical OHLCV bars from Alpaca v2 REST API.
func (c *Client) GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]*marketdatav1.Bar, error) {
	baseURL := fmt.Sprintf("%s/v2/stocks/%s/bars?timeframe=%s&feed=%s&adjustment=%s&start=%s&end=%s&limit=%d",
		c.cfg.DataURL, symbol, alpacaTimeframe(timeframe), c.feedParam(), c.adjustmentParam(),
		start.UTC().Format(time.RFC3339),
		end.UTC().Format(time.RFC3339),
		c.barsLimit(),
	)

	var allBars []*marketdatav1.Bar
	url := baseURL
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		resp, err := c.do(req)
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
			allBars = append(allBars, barFromAlpaca(symbol, b, t, timeframe))
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

	resp, err := c.do(req)
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

// alpacaLatestTradeResponse is the JSON shape of GET /v2/stocks/{sym}/trades/latest.
type alpacaLatestTradeResponse struct {
	Trade struct {
		T string  `json:"t"`
		P float64 `json:"p"`
	} `json:"trade"`
}

// GetLatestTrade fetches the most recent trade price + timestamp from Alpaca. Used by
// GetLatestPrice for the Decide-surface live price.
func (c *Client) GetLatestTrade(ctx context.Context, symbol string) (float64, time.Time, error) {
	url := fmt.Sprintf("%s/v2/stocks/%s/trades/latest?feed=%s", c.cfg.DataURL, symbol, c.feedParam())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, time.Time{}, err
	}
	resp, err := c.do(req)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf("get latest trade: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return 0, time.Time{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return 0, time.Time{}, fmt.Errorf("alpaca trade %d: %s", resp.StatusCode, string(body))
	}
	var result alpacaLatestTradeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, time.Time{}, fmt.Errorf("unmarshal trade: %w", err)
	}
	t, _ := time.Parse(time.RFC3339, result.Trade.T)
	return result.Trade.P, t, nil
}

// multiBarsResponse is the JSON shape of GET /v2/stocks/bars (multi-symbol):
// bars is keyed by symbol.
type multiBarsResponse struct {
	Bars          map[string][]alpacaBar `json:"bars"`
	NextPageToken string                 `json:"next_page_token"`
}

// GetBarsMulti fetches historical bars for several symbols in one request, collapsing the
// per-symbol REST fan-out. Returns a map keyed by symbol; pagination is followed transparently.
func (c *Client) GetBarsMulti(ctx context.Context, symbols []string, timeframe string, start, end time.Time) (map[string][]*marketdatav1.Bar, error) {
	if len(symbols) == 0 {
		return map[string][]*marketdatav1.Bar{}, nil
	}
	baseURL := fmt.Sprintf("%s/v2/stocks/bars?symbols=%s&timeframe=%s&feed=%s&adjustment=%s&start=%s&end=%s&limit=%d",
		c.cfg.DataURL, strings.Join(symbols, ","), alpacaTimeframe(timeframe), c.feedParam(), c.adjustmentParam(),
		start.UTC().Format(time.RFC3339), end.UTC().Format(time.RFC3339), c.barsLimit(),
	)
	out := make(map[string][]*marketdatav1.Bar, len(symbols))
	url := baseURL
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		resp, err := c.do(req)
		if err != nil {
			return nil, fmt.Errorf("get bars multi: %w", err)
		}
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("alpaca bars multi %d: %s", resp.StatusCode, string(body))
		}
		var result multiBarsResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("unmarshal bars multi: %w", err)
		}
		for sym, bars := range result.Bars {
			for _, b := range bars {
				t, err := time.Parse(time.RFC3339, b.T)
				if err != nil {
					continue
				}
				out[sym] = append(out[sym], barFromAlpaca(sym, b, t, timeframe))
			}
		}
		if result.NextPageToken == "" {
			break
		}
		url = baseURL + "&page_token=" + result.NextPageToken
	}
	return out, nil
}

// multiLatestQuotesResponse is the JSON shape of GET /v2/stocks/quotes/latest
// (multi-symbol): quotes is keyed by symbol.
type multiLatestQuotesResponse struct {
	Quotes map[string]struct {
		T  string  `json:"t"`
		AP float64 `json:"ap"`
		AS int32   `json:"as"`
		BP float64 `json:"bp"`
		BS int32   `json:"bs"`
	} `json:"quotes"`
}

// GetLatestQuotesMulti fetches the latest NBBO quote for several symbols in one request
// via GET /v2/stocks/quotes/latest?symbols=A,B,…. Returns a map keyed by symbol.
func (c *Client) GetLatestQuotesMulti(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error) {
	if len(symbols) == 0 {
		return map[string]*marketdatav1.Quote{}, nil
	}
	url := fmt.Sprintf("%s/v2/stocks/quotes/latest?symbols=%s&feed=%s",
		c.cfg.DataURL, strings.Join(symbols, ","), c.feedParam())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, fmt.Errorf("get latest quotes multi: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca quotes multi %d: %s", resp.StatusCode, string(body))
	}
	var result multiLatestQuotesResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal quotes multi: %w", err)
	}
	out := make(map[string]*marketdatav1.Quote, len(result.Quotes))
	for sym, q := range result.Quotes {
		t, _ := time.Parse(time.RFC3339, q.T)
		out[sym] = &marketdatav1.Quote{
			Symbol: sym, Time: timestamppb.New(t),
			AskPrice: q.AP, AskSize: q.AS,
			BidPrice: q.BP, BidSize: q.BS,
			Source: "alpaca",
		}
	}
	return out, nil
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

	resp, err := c.do(req)
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
