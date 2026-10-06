// Package fmp is the Financial Modeling Prep fundamentals integration for xstockstrat-marketdata.
// It implements source.FundamentalsSource and is NEVER registered in the OHLCV source.Registry (FR-2).
package fmp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/xstockstrat/marketdata/internal/source"
)

// ErrFMPDailyCapExceeded is returned before any HTTP call once the shared UTC-day budget is spent.
// Callers map it to serve-stale / ResourceExhausted, never to Unavailable.
var ErrFMPDailyCapExceeded = errors.New("fmp: daily request cap reached")

// ClientConfig holds the FMP connection settings. The API key is never logged.
type ClientConfig struct {
	BaseURL string // e.g. https://financialmodelingprep.com
	APIKey  string // FMP API key (resolved from secret config at startup)
	// Metrics is the tier allowlist ("core","extended"): core = batchable quote (1 call/chunk),
	// extended adds per-symbol ratios-ttm + profile calls.
	Metrics []string
	// HTTPClient is injectable so tests can assert call counts and stub responses.
	HTTPClient *http.Client
	// Limits is read on every call so the rps ceiling and daily cap stay live-tunable from config.
	// nil = unthrottled and uncapped (tests only).
	Limits func() (rps float64, dailyCap int)
	// Now is injectable for UTC-day rollover tests; nil = time.Now.
	Now func() time.Time
}

// Client talks to the FMP "stable" REST API.
type Client struct {
	baseURL  string
	apiKey   string
	extended bool
	http     *http.Client

	// One throttle authority for every FMP call path (fundamentals, enrichment, classification):
	// all of them must share this single *Client instance or the budget splits into N×cap.
	limits  func() (float64, int)
	now     func() time.Time
	limiter *rate.Limiter
	mu      sync.Mutex
	utcDay  string
	used    int
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
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Client{
		baseURL:  strings.TrimRight(cfg.BaseURL, "/"),
		apiKey:   cfg.APIKey,
		extended: extended,
		http:     httpClient,
		limits:   cfg.Limits,
		now:      now,
		limiter:  rate.NewLimiter(rate.Inf, 1),
	}
}

// SeedBudget sets today's used count once at boot (e.g. from the DB) so a mid-day restart cannot
// re-grant a fresh full cap. Never lowers an already-higher in-memory count.
func (c *Client) SeedBudget(used int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rollDayLocked()
	if used > c.used {
		c.used = used
	}
}

// BudgetSnapshot returns today's used count and the live cap (cap <= 0 = uncapped).
func (c *Client) BudgetSnapshot() (used, dailyCap int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rollDayLocked()
	_, dailyCap = c.currentLimits()
	return c.used, dailyCap
}

func (c *Client) currentLimits() (float64, int) {
	if c.limits == nil {
		return 0, 0
	}
	return c.limits()
}

func (c *Client) rollDayLocked() {
	day := c.now().UTC().Format("2006-01-02")
	if c.utcDay != day {
		c.utcDay = day
		c.used = 0
	}
}

// reserve claims one slot of the shared day budget before the HTTP call; returns the slot's UTC day.
func (c *Client) reserve() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rollDayLocked()
	_, dailyCap := c.currentLimits()
	if c.limits != nil && c.used >= dailyCap {
		return "", ErrFMPDailyCapExceeded
	}
	c.used++
	return c.utcDay, nil
}

// refund returns a reserved slot (non-2xx / transport failure) so an outage never self-throttles.
func (c *Client) refund(day string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.utcDay == day && c.used > 0 {
		c.used--
	}
}

// throttle waits on the token bucket (burst=1 → never more than rps calls in any rolling second).
func (c *Client) throttle(ctx context.Context) error {
	rps, _ := c.currentLimits()
	limit := rate.Inf
	if rps > 0 {
		// 2% headroom: dispatch jitter must never let rps+1 calls land inside one vendor second.
		limit = rate.Limit(rps * 0.98)
	}
	if c.limiter.Limit() != limit {
		c.limiter.SetLimit(limit)
	}
	return c.limiter.Wait(ctx)
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
	if err := c.throttle(ctx); err != nil {
		return fmt.Errorf("fmp: rate limiter: %w", err)
	}
	day, err := c.reserve()
	if err != nil {
		return err
	}
	counted := false
	defer func() {
		if !counted {
			c.refund(day)
		}
	}()
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("fmp: %s request failed: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusOK {
		counted = true // a 2xx consumed vendor quota even if the body later fails to decode
	}
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

// fmpQuote is the core-metric subset of /stable/quote. Pointer fields: a key FMP omits or
// sends null decodes to nil, distinct from a real 0.
type fmpQuote struct {
	Symbol    string   `json:"symbol"`
	Price     *float64 `json:"price"`
	MarketCap *float64 `json:"marketCap"`
	PE        *float64 `json:"pe"`
	EPS       *float64 `json:"eps"`
	YearHigh  *float64 `json:"yearHigh"`
	YearLow   *float64 `json:"yearLow"`
	Volume    float64  `json:"volume"`
	Change    float64  `json:"change"`
	Exchange  string   `json:"exchange"`
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
// Pointer fields for the same reason as fmpQuote — an omitted/null ratio must stay nil.
type fmpRatios struct {
	PriceToBookTTM    *float64 `json:"priceToBookRatioTTM"`
	DividendYieldTTM  *float64 `json:"dividendYieldTTM"`
	ReturnOnEquityTTM *float64 `json:"returnOnEquityTTM"`
	DebtToEquityTTM   *float64 `json:"debtToEquityRatioTTM"`
}

func (r *fmpRatios) apply(f *source.Fundamentals) {
	f.PBRatio = r.PriceToBookTTM
	f.DividendYield = r.DividendYieldTTM
	f.ROE = r.ReturnOnEquityTTM
	f.DebtToEquity = r.DebtToEquityTTM
}

// fmpProfile is the subset of /stable/profile carrying beta + currency + sector.
type fmpProfile struct {
	Beta     *float64 `json:"beta"`
	Currency string   `json:"currency"`
	Sector   string   `json:"sector"`
}

// FetchSector returns the symbol's FMP profile sector free text ("" when FMP has none). Routed
// through getJSON, so it shares the same limiter + day budget as every other FMP call.
func (c *Client) FetchSector(ctx context.Context, symbol string) (string, error) {
	p, err := c.fetchProfile(ctx, symbol)
	if err != nil || p == nil {
		return "", err
	}
	return p.Sector, nil
}

func (p *fmpProfile) apply(f *source.Fundamentals) {
	f.Beta = p.Beta
	f.Sector = p.Sector
	if p.Currency != "" {
		f.Currency = p.Currency
	}
}
