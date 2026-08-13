// Package finnhub is the Finnhub fundamentals integration for xstockstrat-marketdata
// (feature 129). It implements source.FundamentalsSource and is held as a dedicated
// service field alongside the FMP client — it is NEVER registered in the OHLCV
// source.Registry (FR-2, carried over from feature 059: the Alpaca/OHLCV path stays
// untouched).
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

// ClientConfig holds the Finnhub connection settings. The API key is never logged.
// Unlike FMP, Finnhub has no core/extended metric tiering — every fundamentals fetch
// always issues all 3 calls (see GetFundamentalsMulti), so there is no Metrics field.
type ClientConfig struct {
	BaseURL string // e.g. https://api.finnhub.io/api/v1
	APIKey  string // Finnhub API key (resolved from secret env var at startup)
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

// GetFundamentalsMulti fetches fundamentals for every symbol in the chunk. Unlike FMP's
// batchable /stable/quote, NONE of Finnhub's fundamentals endpoints accept more than one
// symbol per call (confirmed live this session against api.finnhub.io — see design.md
// Open Risk #2 and context.md's Step 2 session note), so this costs exactly 3 calls per
// symbol (/stock/metric, /quote, /stock/profile2) with no batching to fall back to.
func (c *Client) GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*source.Fundamentals, error) {
	if len(symbols) == 0 {
		return nil, nil
	}
	now := time.Now().UTC()
	out := make([]*source.Fundamentals, 0, len(symbols))
	for _, sym := range symbols {
		f, err := c.fetchOne(ctx, sym, now)
		if err != nil {
			// Skip symbols Finnhub could not fully resolve, mirroring FMP's
			// "skip symbols FMP did not return" behavior (fmp_client.go:107) rather
			// than failing the whole batch on one bad symbol.
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

// getJSON builds a URL under baseURL with the token query param and decodes the JSON
// object response into dst. The token is added to the query, never logged. Mirrors
// fmp_client.go's getJSON exactly, except Finnhub's auth param is "token" (confirmed
// live this session), not "apikey".
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
// Every field name below was confirmed against a LIVE /stock/metric, /quote, and
// /stock/profile2 response this session (context.md § Step 2 session note) — none are
// guessed. Two unit conversions were discovered live and are NOT obvious from field
// names alone:
//   - marketCapitalization is denominated in MILLIONS of USD (Finnhub convention);
//     FMP's marketCap is raw dollars, so this client multiplies by 1_000_000.
//   - roeTTM and currentDividendYieldTTM are percentage-POINT numbers (e.g. 137.18
//     meaning "137.18%"); FMP's ROE/DividendYield are fractions (e.g. 0.005 meaning
//     "0.5%", confirmed via fmp_client_test.go's own fixture), so this client divides
//     both by 100 to match FMP's convention. peTTM, pb, totalDebt/totalEquityQuarterly,
//     and beta are true dimensionless ratios in both providers — no scaling needed.

// finnhubMetricResponse is the /stock/metric?metric=all response envelope.
type finnhubMetricResponse struct {
	Metric finnhubMetric `json:"metric"`
}

// finnhubMetric carries the valuation/profitability ratios. The debt-to-equity field
// name contains a literal "/" — this is Finnhub's actual JSON key, not a typo.
type finnhubMetric struct {
	YearHigh            float64 `json:"52WeekHigh"`
	YearLow             float64 `json:"52WeekLow"`
	Beta                float64 `json:"beta"`
	PERatioTTM          float64 `json:"peTTM"`
	PBRatio             float64 `json:"pb"`
	EPSTTM              float64 `json:"epsTTM"`
	ROETTM              float64 `json:"roeTTM"`
	DebtToEquityQuarter float64 `json:"totalDebt/totalEquityQuarterly"`
	MarketCapMillions   float64 `json:"marketCapitalization"`
	DividendYieldTTM    float64 `json:"currentDividendYieldTTM"`
}

func (m *finnhubMetric) apply(f *source.Fundamentals) {
	f.YearHigh = m.YearHigh
	f.YearLow = m.YearLow
	f.Beta = m.Beta
	f.PERatio = m.PERatioTTM
	f.PBRatio = m.PBRatio
	f.EPS = m.EPSTTM
	f.ROE = m.ROETTM / 100 // percentage-points -> fraction (matches FMP)
	f.DebtToEquity = m.DebtToEquityQuarter
	f.MarketCap = m.MarketCapMillions * 1_000_000 // millions -> raw dollars (matches FMP)
	f.DividendYield = m.DividendYieldTTM / 100    // percentage-points -> fraction (matches FMP)
}

// finnhubQuote is the /quote response — current price only, no symbol echo.
type finnhubQuote struct {
	Price float64 `json:"c"`
}

func (q *finnhubQuote) apply(f *source.Fundamentals) {
	f.Price = q.Price
}

// finnhubProfile2 is the /stock/profile2 response — carries currency. Its own
// marketCapitalization field is deliberately unused (see fetchOne / context.md):
// /stock/metric's value is the single source of truth to avoid two different market
// cap figures for the same symbol.
type finnhubProfile2 struct {
	Currency string `json:"currency"`
}

func (p *finnhubProfile2) apply(f *source.Fundamentals) {
	if p.Currency != "" {
		f.Currency = p.Currency
	}
}
