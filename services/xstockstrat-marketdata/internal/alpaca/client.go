// Package alpaca provides the sole Alpaca Markets API integration for xstockstrat.
// xstockstrat-marketdata is the ONLY service that imports or uses this package.
package alpaca

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/alpacapace"
	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/telemetry"
	tfpkg "github.com/xstockstrat/marketdata/internal/timeframe"
)

// maxBarsLimit is the largest page size Alpaca's bars endpoint accepts (spec maximum).
const maxBarsLimit = 10000

// Operator-approved fixed invariants of the adaptive rate limit, not config keys (CLAUDE.md § Adaptive rate limit).
const (
	minAttempt      = time.Second
	noDeadlineBound = 90 * time.Second
)

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
	// AdaptiveRateLimit is marketdata.alpaca.adaptive_rate_limit_enabled. The zero value must stay the
	// pre-feature single attempt: NewClient callers and test literals rely on it.
	AdaptiveRateLimit bool
	// Adjustment applied to historical bars ("raw"|"split"|"dividend"|"all"); default "all"
	// so splits/dividends do not distort backtest OHLCV. From marketdata.alpaca.adjustment.
	Adjustment string
	// ReconnectDelayMs / MaxReconnects govern the streaming WebSocket reconnect loop
	// (marketdata.stream.reconnect_delay_ms / marketdata.stream.max_reconnects).
	ReconnectDelayMs int
	MaxReconnects    int
	Paper            bool
}

// Settings are the live-tunable Alpaca fields of ClientConfig, re-read on every request.
type Settings struct {
	APIKey           string
	APISecret        string
	BaseURL          string
	DataURL          string
	Feed             string
	Adjustment       string
	BatchSize        int
	RateLimitRPS     int
	ReconnectDelayMs int
	MaxReconnects    int

	AdaptiveRateLimit bool
}

// Client wraps Alpaca REST and streaming APIs.
type Client struct {
	cfg        ClientConfig
	live       func() Settings // nil = the static cfg
	httpClient *http.Client

	limiterMu sync.Mutex
	limiter   *rate.Limiter

	pacer *alpacapace.Pacer
	// Test seams. Deadlines are derived from durations measured on now, never from a now timestamp.
	now    func() time.Time
	sleep  func(ctx context.Context, d time.Duration) error
	jitter func() time.Duration

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
	return newClient(cfg, nil)
}

// NewLiveClient returns an Alpaca client that re-reads settings on every request; the limiter
// is resized in place when RateLimitRPS changes. paper is fixed for the client's lifetime.
func NewLiveClient(settings func() Settings, paper bool) *Client {
	return newClient(ClientConfig{Paper: paper}, settings)
}

func newClient(cfg ClientConfig, live func() Settings) *Client {
	return &Client{
		cfg:        cfg,
		live:       live,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		pacer:      alpacapace.NewPacer(),
		now:        time.Now,
		sleep:      sleepContext,
		jitter:     func() time.Duration { return rand.N(alpacapace.MaxJitter) },
	}
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// conf returns the settings in effect for this request.
func (c *Client) conf() ClientConfig {
	if c.live == nil {
		return c.cfg
	}
	s := c.live()
	return ClientConfig{
		APIKey: s.APIKey, APISecret: s.APISecret, BaseURL: s.BaseURL, DataURL: s.DataURL,
		Feed: s.Feed, Adjustment: s.Adjustment, BatchSize: s.BatchSize, RateLimitRPS: s.RateLimitRPS,
		ReconnectDelayMs: s.ReconnectDelayMs, MaxReconnects: s.MaxReconnects, Paper: c.cfg.Paper,
		AdaptiveRateLimit: s.AdaptiveRateLimit,
	}
}

// currentLimiter returns the limiter sized to rps (nil when rps <= 0 disables limiting).
func (c *Client) currentLimiter(rps int) *rate.Limiter {
	if rps <= 0 {
		return nil
	}
	c.limiterMu.Lock()
	defer c.limiterMu.Unlock()
	if c.limiter == nil {
		c.limiter = rate.NewLimiter(rate.Limit(rps), rps)
	} else if c.limiter.Limit() != rate.Limit(rps) {
		c.limiter.SetLimit(rate.Limit(rps))
		c.limiter.SetBurst(rps)
	}
	return c.limiter
}

// Limit reports the REST limiter's current rate (rate.Inf before any limited request).
func (c *Client) Limit() rate.Limit {
	c.limiterMu.Lock()
	defer c.limiterMu.Unlock()
	if c.limiter == nil {
		return rate.Inf
	}
	return c.limiter.Limit()
}

// do sets auth headers, waits on the rate limiter (if configured), and executes the
// request. Centralizing this keeps every REST call rate-limited and authenticated.
func (c *Client) do(req *http.Request) (*http.Response, error) {
	cfg := c.conf()
	req.Header.Set("APCA-API-KEY-ID", cfg.APIKey)
	req.Header.Set("APCA-API-SECRET-KEY", cfg.APISecret)
	if cfg.AdaptiveRateLimit {
		return c.doPaced(req, cfg)
	}
	ctx, op := req.Context(), alpacaOp(req.URL.Path)
	if limiter := c.currentLimiter(cfg.RateLimitRPS); limiter != nil {
		if err := limiter.Wait(ctx); err != nil {
			telemetry.RecordVendorRequest(ctx, telemetry.VendorAlpaca, op, telemetry.VendorThrottle, time.Time{})
			return nil, fmt.Errorf("rate limiter: %w", err)
		}
	}
	sentAt := time.Now()
	resp, err := c.httpClient.Do(req)
	outcome := telemetry.VendorTransport
	if err == nil {
		outcome = telemetry.VendorOK
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			outcome = telemetry.HTTPErrorOutcome(resp.StatusCode)
		}
	}
	// Duration is time to headers; body read/decode failures happen in the callers and are not counted.
	telemetry.RecordVendorRequest(ctx, telemetry.VendorAlpaca, op, outcome, sentAt)
	return resp, err
}

// pacedCall is one adaptive do call. end is on the client clock: the caller's deadline, or start + noDeadlineBound.
type pacedCall struct {
	op, host    string
	key         alpacapace.Key
	end         time.Time
	hasDeadline bool
}

// doPaced paces from Alpaca's rate-limit headers and retries a 429 only. Marketdata waits, it never fails
// fast: a wait that cannot fit runs to the end of the call and no request is sent after it.
func (c *Client) doPaced(req *http.Request, cfg ClientConfig) (*http.Response, error) {
	ctx := req.Context()
	call := pacedCall{op: alpacaOp(req.URL.Path), host: req.URL.Host, end: c.now().Add(noDeadlineBound)}
	call.key = c.pacer.Key(call.host, cfg.APIKey)
	if deadline, ok := ctx.Deadline(); ok {
		call.end, call.hasDeadline = c.now().Add(time.Until(deadline)), true
	}
	for attempt := 1; ; attempt++ {
		jitter := c.jitter()
		if r := c.pacer.Reserve(call.key, c.now(), call.end.Add(-jitter-minAttempt), jitter); r.Wait > 0 {
			if err := c.pause(ctx, call, r.Wait, r.Fits, r.Hold); err != nil {
				return nil, err
			}
		}
		if limiter := c.currentLimiter(cfg.RateLimitRPS); limiter != nil {
			waitCtx, cancel := c.boundedContext(ctx, call)
			err := limiter.Wait(waitCtx)
			cancel()
			if err != nil {
				return nil, c.refuse(ctx, call, err)
			}
		}
		resp, err := c.sendAttempt(ctx, req, call)
		if err != nil {
			return nil, err
		}
		if headers, ok := alpacapace.ParseHeaders(resp.Header); ok {
			c.pacer.Observe(call.key, headers, c.now())
		}
		if resp.StatusCode != http.StatusTooManyRequests {
			return resp, nil
		}
		reset, _ := alpacapace.ParseReset(resp.Header)
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		now := c.now()
		wait := alpacapace.RetryWait(attempt, now, reset, c.jitter())
		if err := c.pause(ctx, call, wait, !now.Add(wait+minAttempt).After(call.end), true); err != nil {
			return nil, err
		}
	}
}

// sendAttempt records the attempt on the caller's context, so "ctx" is reported only when the caller ended it.
func (c *Client) sendAttempt(ctx context.Context, req *http.Request, call pacedCall) (*http.Response, error) {
	sendCtx, cancel := c.boundedContext(ctx, call)
	sentAt := time.Now()
	resp, err := c.httpClient.Do(req.Clone(sendCtx))
	outcome := telemetry.VendorTransport
	if err == nil {
		outcome = telemetry.VendorOK
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			outcome = telemetry.HTTPErrorOutcome(resp.StatusCode)
		}
	}
	telemetry.RecordVendorRequest(ctx, telemetry.VendorAlpaca, call.op, outcome, sentAt)
	if err != nil {
		cancel()
		return nil, err
	}
	resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

// boundedContext caps a call that has no deadline at its end; the cancel must run once the wait or body is done.
func (c *Client) boundedContext(ctx context.Context, call pacedCall) (context.Context, context.CancelFunc) {
	if call.hasDeadline {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, max(call.end.Sub(c.now()), 0))
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelOnClose) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}

// pause sleeps one adaptive wait. A nil return is the only case in which the caller may send.
// throttled is a hold or a 429 wait; a spread slot is not logged.
func (c *Client) pause(ctx context.Context, call pacedCall, wait time.Duration, fits, throttled bool) error {
	now := c.now()
	if throttled && c.pacer.WarnOnce(call.key, now, now.Add(wait)) {
		slog.WarnContext(ctx, "alpaca rate limit: throttled", "host", call.host, "wait_ms", wait.Milliseconds())
	}
	if fits {
		if err := c.sleep(ctx, wait); err != nil {
			return c.refuse(ctx, call, err)
		}
		return nil
	}
	err := c.sleep(ctx, max(call.end.Sub(now), 0))
	if err == nil && call.hasDeadline {
		// The timer can beat the context by a scheduling tick; the outcome must still read as the caller's deadline.
		<-ctx.Done()
		err = ctx.Err()
	}
	return c.refuse(ctx, call, err)
}

// refuse records the one point of a wait that ended early: "ctx" when the caller's context ended it, else "throttle".
func (c *Client) refuse(ctx context.Context, call pacedCall, cause error) error {
	telemetry.RecordVendorRequest(ctx, telemetry.VendorAlpaca, call.op, telemetry.VendorThrottle, time.Time{})
	if cause == nil {
		return fmt.Errorf("alpaca %s rate limited by %s", call.op, call.host)
	}
	return fmt.Errorf("alpaca %s rate limited by %s: %w", call.op, call.host, cause)
}

// alpacaOp maps a REST path to its closed op label; the path itself (it can carry a symbol) is never a label.
func alpacaOp(path string) string {
	switch {
	case strings.HasSuffix(path, "/bars"):
		return "bars"
	case strings.HasSuffix(path, "/quotes/latest"):
		return "quotes_latest"
	case strings.HasSuffix(path, "/trades/latest"):
		return "trades_latest"
	case strings.HasSuffix(path, "/assets"):
		return "assets"
	case strings.HasSuffix(path, "/corporate-actions"):
		return "dividends"
	}
	return telemetry.Other
}

// feedParam returns the configured feed, defaulting to "iex" (free-plan requirement).
func (c *Client) feedParam() string {
	if feed := c.conf().Feed; feed != "" {
		return feed
	}
	return "iex"
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
	if adj := c.conf().Adjustment; adj != "" {
		return adj
	}
	return "all"
}

// barsLimit returns the configured per-request bar limit, clamped to the spec maximum.
func (c *Client) barsLimit() int {
	if n := c.conf().BatchSize; n > 0 && n <= maxBarsLimit {
		return n
	}
	return maxBarsLimit
}

// GetBars fetches historical OHLCV bars from Alpaca v2 REST API.
func (c *Client) GetBars(ctx context.Context, symbol, timeframe string, start, end time.Time) ([]*marketdatav1.Bar, error) {
	baseURL := fmt.Sprintf("%s/v2/stocks/%s/bars?timeframe=%s&feed=%s&adjustment=%s&start=%s&end=%s&limit=%d",
		c.conf().DataURL, symbol, alpacaTimeframe(timeframe), c.feedParam(), c.adjustmentParam(),
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

type alpacaCashDividend struct {
	Symbol      string  `json:"symbol"`
	ExDate      string  `json:"ex_date"`
	PayableDate string  `json:"payable_date"`
	Rate        float64 `json:"rate"`
}

type alpacaCorpActionsResponse struct {
	CorporateActions struct {
		CashDividends []alpacaCashDividend `json:"cash_dividends"`
	} `json:"corporate_actions"`
	NextPageToken string `json:"next_page_token"`
}

// GetCashDividends fetches cash-dividend corporate actions from Alpaca's v1 corporate-actions REST
// API (feature 211, FR-4). A non-200 (e.g. an unentitled plan returns 4xx) surfaces as an error so
// the caller degrades dividend_yield to missing — never a fabricated 0 (the 0-vs-missing rule lives
// in the service layer, which distinguishes "feed had rows but none in-window" from "no feed").
func (c *Client) GetCashDividends(ctx context.Context, symbol string, start, end time.Time) ([]source.CashDividend, error) {
	baseURL := fmt.Sprintf("%s/v1/corporate-actions?types=cash_dividend&symbols=%s&start=%s&end=%s&limit=1000",
		c.conf().DataURL, symbol,
		start.UTC().Format("2006-01-02"),
		end.UTC().Format("2006-01-02"),
	)
	var out []source.CashDividend
	url := baseURL
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}
		resp, err := c.do(req)
		if err != nil {
			return nil, fmt.Errorf("get corporate-actions: %w", err)
		}
		body, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("alpaca corporate-actions %d: %s", resp.StatusCode, string(body))
		}
		var result alpacaCorpActionsResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("unmarshal corporate-actions: %w", err)
		}
		for _, d := range result.CorporateActions.CashDividends {
			ex, err := time.Parse("2006-01-02", d.ExDate)
			if err != nil {
				continue
			}
			cd := source.CashDividend{Symbol: symbol, ExDate: ex, CashAmount: d.Rate, Currency: "USD"}
			if pd, perr := time.Parse("2006-01-02", d.PayableDate); perr == nil {
				cd.PayDate = &pd
			}
			out = append(out, cd)
		}
		if result.NextPageToken == "" {
			break
		}
		url = baseURL + "&page_token=" + result.NextPageToken
	}
	return out, nil
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
	url := fmt.Sprintf("%s/v2/stocks/%s/quotes/latest?feed=%s", c.conf().DataURL, symbol, c.feedParam())
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
	url := fmt.Sprintf("%s/v2/stocks/%s/trades/latest?feed=%s", c.conf().DataURL, symbol, c.feedParam())
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

// multiLatestTradesResponse is the JSON shape of GET /v2/stocks/trades/latest (multi-symbol).
type multiLatestTradesResponse struct {
	Trades map[string]struct {
		T string  `json:"t"`
		P float64 `json:"p"`
	} `json:"trades"`
}

// GetLatestTradesMulti fetches the latest trade for several symbols in one request
// via GET /v2/stocks/trades/latest?symbols=A,B,…&feed=…. Returns a map keyed by symbol.
func (c *Client) GetLatestTradesMulti(ctx context.Context, symbols []string) (map[string]*source.Trade, error) {
	if len(symbols) == 0 {
		return map[string]*source.Trade{}, nil
	}
	url := fmt.Sprintf("%s/v2/stocks/trades/latest?symbols=%s&feed=%s",
		c.conf().DataURL, strings.Join(symbols, ","), c.feedParam())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.do(req)
	if err != nil {
		return nil, fmt.Errorf("get latest trades multi: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alpaca trades multi %d: %s", resp.StatusCode, string(body))
	}
	var result multiLatestTradesResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal trades multi: %w", err)
	}
	out := make(map[string]*source.Trade, len(result.Trades))
	for sym, tr := range result.Trades {
		t, _ := time.Parse(time.RFC3339, tr.T)
		out[sym] = &source.Trade{Price: tr.P, TradeTime: t}
	}
	return out, nil
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
		c.conf().DataURL, strings.Join(symbols, ","), alpacaTimeframe(timeframe), c.feedParam(), c.adjustmentParam(),
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
		c.conf().DataURL, strings.Join(symbols, ","), c.feedParam())
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
	url := fmt.Sprintf("%s/v2/assets?status=active", c.conf().BaseURL)
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
