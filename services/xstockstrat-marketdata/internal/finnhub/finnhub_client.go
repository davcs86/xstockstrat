// Package finnhub is the Finnhub fundamentals integration for xstockstrat-marketdata. It
// implements source.FundamentalsSource and is NEVER registered in the OHLCV source.Registry (FR-2).
package finnhub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// ClientConfig holds Finnhub connection settings. The API key is never logged. No metric
// tiering (unlike FMP) — every fetch issues all 3 calls, so there is no Metrics field.
type ClientConfig struct {
	BaseURL string // e.g. https://api.finnhub.io/api/v1
	APIKey  string // Finnhub API key (resolved from config secret at startup)
	// HTTPClient is injectable so tests can assert call counts and stub responses.
	HTTPClient *http.Client
}

// Client talks to the Finnhub REST API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// NewClient constructs a Finnhub client. A nil HTTPClient defaults to a 30s-timeout client.
func NewClient(cfg ClientConfig) *Client {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:  cfg.APIKey,
		http:    httpClient,
	}
}

var _ source.FundamentalsSource = (*Client)(nil)

// GetFundamentals fetches a single symbol (delegates to the batched path).
func (c *Client) GetFundamentals(ctx context.Context, symbol string) (*source.Fundamentals, error) {
	out, err := c.GetFundamentalsMulti(ctx, []string{symbol})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("finnhub: no fundamentals for %q", symbol)
	}
	return out[0], nil
}

// GetFundamentalsMulti fetches fundamentals for every symbol in the chunk. None of Finnhub's
// endpoints batch, so this costs exactly 3 calls per symbol (/stock/metric, /quote, /stock/profile2).
func (c *Client) GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*source.Fundamentals, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	now := time.Now().UTC()
	out := make([]*source.Fundamentals, 0, len(symbols))
	for _, sym := range symbols {
		f, err := c.fetchOne(ctx, sym, now)
		if err != nil {
			// Skip symbols Finnhub could not fully resolve rather than failing the whole batch
			// on one bad symbol (mirrors FMP).
			continue
		}
		out = append(out, f)
	}
	return out, nil
}

// fetchOne issues the 3 required per-symbol calls and merges them into one Fundamentals.
func (c *Client) fetchOne(ctx context.Context, symbol string, now time.Time) (*source.Fundamentals, error) {
	metric, err := c.fetchMetric(ctx, symbol)
	if err != nil {
		return nil, err
	}
	quote, err := c.fetchQuote(ctx, symbol)
	if err != nil {
		return nil, err
	}
	profile, err := c.fetchProfile(ctx, symbol)
	if err != nil {
		return nil, err
	}

	f := &source.Fundamentals{
		Symbol:       strings.ToUpper(symbol),
		ExtraMetrics: map[string]float64{},
		AsOf:         now,
		Source:       "finnhub",
	}
	metric.Metric.apply(f)
	quote.apply(f)
	profile.apply(f)
	return f, nil
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

// getJSON builds a URL under baseURL with the "token" auth param (never logged) and decodes
// the JSON response into dst. Finnhub's auth param is "token", not FMP's "apikey".
func (c *Client) getJSON(ctx context.Context, path string, params url.Values, dst any) error {
	if params == nil {
		params = url.Values{}
	}
	params.Set("token", c.apiKey)
	u := c.baseURL + path + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("finnhub: build request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("finnhub: %s request failed: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("finnhub: read %s body: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		// Never include the URL (it carries the token) in the error.
		return fmt.Errorf("finnhub: %s returned HTTP %d", path, resp.StatusCode)
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("finnhub: decode %s: %w", path, err)
	}
	return nil
}

func (c *Client) fetchMetric(ctx context.Context, symbol string) (*finnhubMetricResponse, error) {
	var resp finnhubMetricResponse
	params := url.Values{}
	params.Set("symbol", symbol)
	params.Set("metric", "all")
	if err := c.getJSON(ctx, "/stock/metric", params, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) fetchQuote(ctx context.Context, symbol string) (*finnhubQuote, error) {
	var q finnhubQuote
	params := url.Values{}
	params.Set("symbol", symbol)
	if err := c.getJSON(ctx, "/quote", params, &q); err != nil {
		return nil, err
	}
	return &q, nil
}

func (c *Client) fetchProfile(ctx context.Context, symbol string) (*finnhubProfile2, error) {
	var p finnhubProfile2
	params := url.Values{}
	params.Set("symbol", symbol)
	if err := c.getJSON(ctx, "/stock/profile2", params, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// ── Finnhub response shapes ──────────────────────────────────────────────────
//
// Finnhub unit quirks vs FMP: marketCapitalization is in MILLIONS of USD (×1e6 to raw
// dollars); roeTTM and currentDividendYieldTTM are percentage-points (÷100 to fractions).

// finnhubMetricResponse is the /stock/metric?metric=all response envelope.
type finnhubMetricResponse struct {
	Metric finnhubMetric `json:"metric"`
}

// finnhubMetric carries valuation/profitability ratios. The debt-to-equity JSON key literally
// contains "/" (not a typo). Pointer fields: an omitted/null key must decode to nil, not 0.
type finnhubMetric struct {
	YearHigh            *float64 `json:"52WeekHigh"`
	YearLow             *float64 `json:"52WeekLow"`
	Beta                *float64 `json:"beta"`
	PERatioTTM          *float64 `json:"peTTM"`
	PBRatio             *float64 `json:"pb"`
	EPSTTM              *float64 `json:"epsTTM"`
	ROETTM              *float64 `json:"roeTTM"`
	DebtToEquityQuarter *float64 `json:"totalDebt/totalEquityQuarterly"`
	MarketCapMillions   *float64 `json:"marketCapitalization"`
	DividendYieldTTM    *float64 `json:"currentDividendYieldTTM"`
}

// scale100 divides a percentage-point pointer by 100 (FMP's fraction convention), preserving nil.
func scale100(v *float64) *float64 {
	if v == nil {
		return nil
	}
	scaled := *v / 100
	return &scaled
}

// millionsToDollars converts a *float64 in millions of USD to raw dollars, preserving nil.
func millionsToDollars(v *float64) *float64 {
	if v == nil {
		return nil
	}
	dollars := *v * 1_000_000
	return &dollars
}

func (m *finnhubMetric) apply(f *source.Fundamentals) {
	f.YearHigh = m.YearHigh
	f.YearLow = m.YearLow
	f.Beta = m.Beta
	f.PERatio = m.PERatioTTM
	f.PBRatio = m.PBRatio
	f.EPS = m.EPSTTM
	f.ROE = scale100(m.ROETTM) // percentage-points -> fraction (matches FMP)
	f.DebtToEquity = m.DebtToEquityQuarter
	f.MarketCap = millionsToDollars(m.MarketCapMillions) // millions -> raw dollars (matches FMP)
	f.DividendYield = scale100(m.DividendYieldTTM)       // percentage-points -> fraction (matches FMP)
}

// finnhubQuote is the /quote response — current price only, no symbol echo.
type finnhubQuote struct {
	Price *float64 `json:"c"`
}

func (q *finnhubQuote) apply(f *source.Fundamentals) {
	f.Price = q.Price
}

// finnhubProfile2 is the /stock/profile2 response — carries currency. Its own
// marketCapitalization is deliberately unused; /stock/metric is the single market-cap source.
type finnhubProfile2 struct {
	Currency string `json:"currency"`
}

func (p *finnhubProfile2) apply(f *source.Fundamentals) {
	if p.Currency != "" {
		f.Currency = p.Currency
	}
}
