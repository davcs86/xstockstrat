// Package edgar implements a keyless SEC EDGAR XBRL companyfacts client that produces a
// point-in-time historical fundamentals time series (feature 198). It is a
// source.HistoricalFundamentalsSource, held as its own marketdata-service field and never
// registered in the snapshot provider selector (FR-2 / T-3).
//
// SEC fair-use: requests carry a descriptive User-Agent (config marketdata.edgar.user_agent) and
// are rate-limited to marketdata.edgar.rate_limit_rps. No API key is used (F-06).
package edgar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// defaultTickerURL is where SEC hosts the ticker→CIK map (NOT under data.sec.gov).
const defaultTickerURL = "https://www.sec.gov/files/company_tickers.json"

// Client fetches historical fundamentals from SEC EDGAR XBRL companyfacts.
type Client struct {
	baseURL   string // e.g. https://data.sec.gov
	tickerURL string
	userAgent string
	hc        *http.Client

	rateMu      sync.Mutex
	minInterval time.Duration
	lastCall    time.Time

	cikMu    sync.RWMutex
	cikCache map[string]string // upper ticker → zero-padded 10-digit CIK
}

// NewClient builds an EDGAR client. rateLimitRPS <= 0 disables rate limiting.
func NewClient(baseURL, userAgent string, rateLimitRPS int) *Client {
	base := strings.TrimRight(baseURL, "/")
	if base == "" {
		base = "https://data.sec.gov"
	}
	var minInterval time.Duration
	if rateLimitRPS > 0 {
		minInterval = time.Second / time.Duration(rateLimitRPS)
	}
	return &Client{
		baseURL:     base,
		tickerURL:   defaultTickerURL,
		userAgent:   userAgent,
		hc:          &http.Client{Timeout: 30 * time.Second},
		minInterval: minInterval,
		cikCache:    make(map[string]string),
	}
}

// throttle enforces the configured minimum spacing between outbound SEC calls.
func (c *Client) throttle() {
	if c.minInterval <= 0 {
		return
	}
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	if wait := c.minInterval - time.Since(c.lastCall); wait > 0 {
		time.Sleep(wait)
	}
	c.lastCall = time.Now()
}

func (c *Client) get(ctx context.Context, url string, out any) error {
	c.throttle()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// SEC fair-use requires a descriptive User-Agent; a missing one gets 403.
	req.Header.Set("User-Agent", c.userAgent)
	// Never set Accept-Encoding here: doing so disables net/http's transparent gzip decompression,
	// and SEC's CDN serves gzip — the raw compressed body would then fail JSON decode ('\x1f').
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("edgar GET %s: status %d: %s", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// --- SEC companyfacts JSON shapes ---

type tickerEntry struct {
	CIK    json.Number `json:"cik_str"`
	Ticker string      `json:"ticker"`
}

type companyFacts struct {
	CIK        json.Number                     `json:"cik"`
	EntityName string                          `json:"entityName"`
	Facts      map[string]map[string]factEntry `json:"facts"` // taxonomy → tag → entry
}

type factEntry struct {
	Label string                 `json:"label"`
	Units map[string][]unitDatum `json:"units"` // unit → data points
}

type unitDatum struct {
	Start string  `json:"start"` // "YYYY-MM-DD" (duration facts only)
	End   string  `json:"end"`   // "YYYY-MM-DD"
	Val   float64 `json:"val"`
	Accn  string  `json:"accn"`
	FY    int     `json:"fy"`
	FP    string  `json:"fp"`   // "Q1".."Q3","FY"
	Form  string  `json:"form"` // "10-Q","10-K",...
	Filed string  `json:"filed"`
}

// resolveCIK maps a ticker to its zero-padded 10-digit CIK (cached).
func (c *Client) resolveCIK(ctx context.Context, symbol string) (string, error) {
	key := strings.ToUpper(strings.TrimSpace(symbol))
	c.cikMu.RLock()
	cik, ok := c.cikCache[key]
	c.cikMu.RUnlock()
	if ok {
		return cik, nil
	}
	var raw map[string]tickerEntry
	if err := c.get(ctx, c.tickerURL, &raw); err != nil {
		return "", fmt.Errorf("resolve CIK for %s: %w", symbol, err)
	}
	c.cikMu.Lock()
	defer c.cikMu.Unlock()
	for _, e := range raw {
		if e.Ticker == "" {
			continue
		}
		c.cikCache[strings.ToUpper(e.Ticker)] = fmt.Sprintf("%010s", e.CIK.String())
	}
	if cik, ok = c.cikCache[key]; ok {
		return cik, nil
	}
	return "", fmt.Errorf("no CIK for ticker %q", symbol)
}

// tagField maps XBRL us-gaap/dei tags onto the platform metric vocabulary. Duration (flow) tags and
// instant tags are handled separately; a tag not listed here spills into extra_metrics.
var (
	// flow (duration) tags → the accumulator key used to build a period
	flowTags = map[string]string{
		"NetIncomeLoss": "net_income",
		"Revenues":      "revenue",
		"RevenueFromContractWithCustomerExcludingAssessedTax": "revenue",
		"EarningsPerShareDiluted":                             "eps",
		"EarningsPerShareBasic":                               "eps_basic",
	}
	// instant tags → key
	instantTags = map[string]string{
		"StockholdersEquity":                 "stockholders_equity",
		"Liabilities":                        "liabilities",
		"Assets":                             "assets",
		"CommonStockSharesOutstanding":       "shares",
		"EntityCommonStockSharesOutstanding": "shares",
	}
)

const (
	quarterMinDays = 80
	quarterMaxDays = 100
	annualMinDays  = 350
	annualMaxDays  = 380
)

type periodAgg struct {
	fy         int
	fp         string
	periodType string
	periodEnd  time.Time
	filed      time.Time
	vals       map[string]float64
}

func parseDate(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func periodKey(fy int, fp string) string { return fmt.Sprintf("%d-%s", fy, fp) }

// FetchHistorical implements source.HistoricalFundamentalsSource: one companyfacts fetch yields the
// full point-in-time series; callers filter by period_end range + as_of at read time.
func (c *Client) FetchHistorical(ctx context.Context, symbol string, from, to time.Time, periodTypes []string) ([]source.HistoricalFundamentalsPeriod, error) {
	cik, err := c.resolveCIK(ctx, symbol)
	if err != nil {
		return nil, err
	}
	var cf companyFacts
	url := fmt.Sprintf("%s/api/xbrl/companyfacts/CIK%s.json", c.baseURL, cik)
	if err := c.get(ctx, url, &cf); err != nil {
		return nil, fmt.Errorf("companyfacts %s: %w", symbol, err)
	}

	wantQuarterly, wantAnnual := periodTypeWanted(periodTypes)
	aggs := map[string]*periodAgg{}

	for _, tags := range cf.Facts { // us-gaap, dei, ...
		for tag, entry := range tags {
			flowKey, isFlow := flowTags[tag]
			instKey, isInstant := instantTags[tag]
			if !isFlow && !isInstant {
				continue
			}
			for _, unit := range entry.Units {
				for _, d := range unit {
					if d.FP == "" || d.FY == 0 {
						continue
					}
					ptype := classifyPeriodType(d)
					if ptype == "" {
						continue // wrong-duration flow point (YTD 6mo/9mo) or unclassifiable
					}
					if ptype == "quarterly" && !wantQuarterly {
						continue
					}
					if ptype == "annual" && !wantAnnual {
						continue
					}
					end, ok := parseDate(d.End)
					if !ok {
						continue
					}
					filed, ok := parseDate(d.Filed)
					if !ok {
						continue
					}
					key := periodKey(d.FY, d.FP)
					agg := aggs[key]
					if agg == nil {
						agg = &periodAgg{fy: d.FY, fp: d.FP, periodType: ptype, periodEnd: end, filed: filed, vals: map[string]float64{}}
						aggs[key] = agg
					}
					// Keep the earliest filing (original as-reported) — @AC-1 idempotency.
					if filed.Before(agg.filed) {
						agg.filed = filed
					}
					if end.After(agg.periodEnd) {
						agg.periodEnd = end
					}
					name := flowKey
					if isInstant {
						name = instKey
					}
					if _, seen := agg.vals[name]; !seen {
						agg.vals[name] = d.Val
					}
				}
			}
		}
	}

	out := make([]source.HistoricalFundamentalsPeriod, 0, len(aggs))
	for _, a := range aggs {
		if !from.IsZero() && a.periodEnd.Before(from) {
			continue
		}
		if !to.IsZero() && a.periodEnd.After(to) {
			continue
		}
		out = append(out, buildPeriod(symbol, a))
	}
	return out, nil
}

// classifyPeriodType returns "quarterly"/"annual"/"" for a data point. Instant facts (no Start)
// take their type from fp; flow facts must have a matching duration (rejecting YTD 6mo/9mo rollups).
func classifyPeriodType(d unitDatum) string {
	isAnnualFP := d.FP == "FY"
	if d.Start == "" { // instant fact (balance-sheet / shares)
		if isAnnualFP {
			return "annual"
		}
		return "quarterly"
	}
	start, ok1 := parseDate(d.Start)
	end, ok2 := parseDate(d.End)
	if !ok1 || !ok2 {
		return ""
	}
	days := int(end.Sub(start).Hours()/24) + 1
	switch {
	case isAnnualFP && days >= annualMinDays && days <= annualMaxDays:
		return "annual"
	case !isAnnualFP && days >= quarterMinDays && days <= quarterMaxDays:
		return "quarterly"
	default:
		return "" // e.g. a YTD 6-month NetIncomeLoss on a Q2 filing
	}
}

func buildPeriod(symbol string, a *periodAgg) source.HistoricalFundamentalsPeriod {
	p := source.HistoricalFundamentalsPeriod{
		Symbol:       symbol,
		FiscalPeriod: fmt.Sprintf("%s-%d", a.fp, a.fy),
		PeriodType:   a.periodType,
		PeriodEnd:    a.periodEnd,
		FiledDate:    a.filed,
		ExtraMetrics: map[string]float64{},
		Currency:     "USD",
		Source:       "edgar",
	}
	if a.fp == "FY" {
		p.FiscalPeriod = fmt.Sprintf("FY%d", a.fy)
	}
	setPtr := func(dst **float64, key string) {
		if v, ok := a.vals[key]; ok {
			vv := v
			*dst = &vv
		}
	}
	setPtr(&p.EPS, "eps")
	if p.EPS == nil {
		setPtr(&p.EPS, "eps_basic")
	}
	setPtr(&p.SharesOutstanding, "shares")
	// Derived ratios (statement-native, PIT-safe): roe = net_income/equity, d/e = liabilities/equity.
	if ni, ok := a.vals["net_income"]; ok {
		if eq, ok2 := a.vals["stockholders_equity"]; ok2 && eq != 0 {
			roe := ni / eq
			p.ROE = &roe
		}
	}
	if liab, ok := a.vals["liabilities"]; ok {
		if eq, ok2 := a.vals["stockholders_equity"]; ok2 && eq != 0 {
			de := liab / eq
			p.DebtToEquity = &de
		}
	}
	// Statement line items that have no canonical metric field spill into extra_metrics.
	for _, k := range []string{"revenue", "net_income", "assets", "liabilities", "stockholders_equity"} {
		if v, ok := a.vals[k]; ok {
			p.ExtraMetrics[k] = v
		}
	}
	return p
}

func periodTypeWanted(periodTypes []string) (quarterly, annual bool) {
	if len(periodTypes) == 0 {
		return true, true
	}
	for _, pt := range periodTypes {
		switch strings.ToLower(strings.TrimSpace(pt)) {
		case "quarterly":
			quarterly = true
		case "annual":
			annual = true
		case "both":
			quarterly, annual = true, true
		}
	}
	return quarterly, annual
}

var _ source.HistoricalFundamentalsSource = (*Client)(nil)
