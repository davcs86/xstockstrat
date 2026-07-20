// Package fmp is the Financial Modeling Prep (FMP) fundamentals integration for
// xstockstrat-marketdata (feature 059). It implements source.FundamentalsSource and
// is held as a dedicated service field — it is NEVER registered in the OHLCV
// source.Registry (FR-2: the Alpaca/OHLCV path stays untouched).
package fmp

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

// ClientConfig holds the FMP connection settings. The API key is never logged.
type ClientConfig struct {
	BaseURL string // e.g. https://financialmodelingprep.com
	APIKey  string // FMP API key (resolved from secret config at startup)
	// Metrics is the allowlist of metric tiers to fetch ("core", "extended").
	// Core metrics come from the batchable quote endpoint (1 call/scan chunk);
	// extended metrics add per-symbol ratios-ttm + profile calls.
	Metrics []string
	// HTTPClient is injectable so tests can assert call counts and stub responses.
	HTTPClient *http.Client
}

// Client talks to the FMP "stable" REST API.
type Client struct {
	baseURL  string
	apiKey   string
	extended bool
	http     *http.Client
}

// NewClient constructs an FMP client. A nil HTTPClient defaults to a 30s-timeout client.
func NewClient(cfg ClientConfig) *Client {
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	extended := false
	for _, m := range cfg.Metrics {
		if strings.EqualFold(strings.TrimSpace(m), "extended") {
			extended = true
		}
	}
	return &Client{
		baseURL:  strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:   cfg.APIKey,
		extended: extended,
		http:     httpClient,
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
		return nil, fmt.Errorf("fmp: no fundamentals for %q", symbol)
	}
	return out[0], nil
}

// GetFundamentalsMulti fetches core metrics for the whole chunk in ONE quote call,
// then (when extended is enabled) augments each symbol via ratios-ttm + profile.
func (c *Client) GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*source.Fundamentals, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	quotes, err := c.fetchQuotes(ctx, symbols)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	bySymbol := make(map[string]*source.Fundamentals, len(quotes))
	for i := range quotes {
		q := quotes[i]
		f := q.toFundamentals(now)
		bySymbol[strings.ToUpper(f.Symbol)] = f
	}

	if c.extended {
		for _, sym := range symbols {
			f, ok := bySymbol[strings.ToUpper(sym)]
			if !ok {
				continue
			}
			if r, rErr := c.fetchRatios(ctx, sym); rErr == nil && r != nil {
				r.apply(f)
			}
			if p, pErr := c.fetchProfile(ctx, sym); pErr == nil && p != nil {
				p.apply(f)
			}
		}
	}

	// Preserve requested order; skip symbols FMP did not return.
	out := make([]*source.Fundamentals, 0, len(symbols))
	for _, sym := range symbols {
		if f, ok := bySymbol[strings.ToUpper(sym)]; ok {
			out = append(out, f)
		}
	}
	return out, nil
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

// getJSON builds a URL under baseURL with the apiKey query param and decodes the
// JSON array response into dst. The apiKey is added to the query, never logged.
func (c *Client) getJSON(ctx context.Context, path string, params url.Values, dst any) error {
	if params == nil {
		params = url.Values{}
	}
	params.Set("apikey", c.apiKey)
	u := c.baseURL + path + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("fmp: build request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("fmp: %s request failed: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("fmp: read %s body: %w", path, err)
	}
	if resp.StatusCode != http.StatusOK {
		// Never include the URL (it carries the apikey) in the error.
		return fmt.Errorf("fmp: %s returned HTTP %d", path, resp.StatusCode)
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("fmp: decode %s: %w", path, err)
	}
	return nil
}

func (c *Client) fetchQuotes(ctx context.Context, symbols []string) ([]fmpQuote, error) {
	var quotes []fmpQuote
	params := url.Values{}
	params.Set("symbol", strings.Join(symbols, ","))
	if err := c.getJSON(ctx, "/stable/quote", params, &quotes); err != nil {
		return nil, err
	}
	return quotes, nil
}

func (c *Client) fetchRatios(ctx context.Context, symbol string) (*fmpRatios, error) {
	var ratios []fmpRatios
	params := url.Values{}
	params.Set("symbol", symbol)
	if err := c.getJSON(ctx, "/stable/ratios-ttm", params, &ratios); err != nil {
		return nil, err
	}
	if len(ratios) == 0 {
		return nil, nil
	}
	return &ratios[0], nil
}

func (c *Client) fetchProfile(ctx context.Context, symbol string) (*fmpProfile, error) {
	var profiles []fmpProfile
	params := url.Values{}
	params.Set("symbol", symbol)
	if err := c.getJSON(ctx, "/stable/profile", params, &profiles); err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return nil, nil
	}
	return &profiles[0], nil
}

// ── FMP response shapes ──────────────────────────────────────────────────────

// fmpQuote is the subset of the /stable/quote object carrying core metrics.
type fmpQuote struct {
	Symbol    string  `json:"symbol"`
	Price     float64 `json:"price"`
	MarketCap float64 `json:"marketCap"`
	PE        float64 `json:"pe"`
	EPS       float64 `json:"eps"`
	YearHigh  float64 `json:"yearHigh"`
	YearLow   float64 `json:"yearLow"`
	Volume    float64 `json:"volume"`
	Change    float64 `json:"change"`
	Exchange  string  `json:"exchange"`
}

func (q fmpQuote) toFundamentals(now time.Time) *source.Fundamentals {
	extra := map[string]float64{}
	if q.Volume != 0 {
		extra["volume"] = q.Volume
	}
	if q.Change != 0 {
		extra["change"] = q.Change
	}
	return &source.Fundamentals{
		Symbol:       q.Symbol,
		Price:        q.Price,
		MarketCap:    q.MarketCap,
		PERatio:      q.PE,
		EPS:          q.EPS,
		YearHigh:     q.YearHigh,
		YearLow:      q.YearLow,
		ExtraMetrics: extra,
		AsOf:         now,
		Source:       "fmp",
	}
}

// fmpRatios is the subset of /stable/ratios-ttm carrying extended valuation ratios.
type fmpRatios struct {
	PriceToBookTTM    float64 `json:"priceToBookRatioTTM"`
	DividendYieldTTM  float64 `json:"dividendYieldTTM"`
	ReturnOnEquityTTM float64 `json:"returnOnEquityTTM"`
	DebtToEquityTTM   float64 `json:"debtToEquityRatioTTM"`
}

func (r *fmpRatios) apply(f *source.Fundamentals) {
	f.PBRatio = r.PriceToBookTTM
	f.DividendYield = r.DividendYieldTTM
	f.ROE = r.ReturnOnEquityTTM
	f.DebtToEquity = r.DebtToEquityTTM
}

// fmpProfile is the subset of /stable/profile carrying beta + currency.
type fmpProfile struct {
	Beta     float64 `json:"beta"`
	Currency string  `json:"currency"`
}

func (p *fmpProfile) apply(f *source.Fundamentals) {
	f.Beta = p.Beta
	if p.Currency != "" {
		f.Currency = p.Currency
	}
}
