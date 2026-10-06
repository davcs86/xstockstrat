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
	"sort"
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
		// Financial-debt line items (feature 211, FR-2) — us-gaap only; summed no-double-count in
		// buildPeriod. All three acceptance filers report us-gaap (no IFRS tags — C-18).
		"LongTermDebtNoncurrent":    "long_term_debt_noncurrent",
		"LongTermDebtCurrent":       "long_term_debt_current",
		"LongTermDebt":              "long_term_debt",
		"DebtCurrent":               "debt_current",
		"ShortTermBorrowings":       "short_term_borrowings",
		"CommercialPaper":           "commercial_paper",
		"ConvertibleDebtNoncurrent": "convertible_debt_noncurrent",
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
	vals       map[string]map[string]float64 // metric → XBRL unit code (USD/CNY/USD-per-shares) → first-seen value
}

// valIn returns the metric's value under a specific unit code.
func valIn(a *periodAgg, metric, unit string) (float64, bool) {
	if m, ok := a.vals[metric]; ok {
		if v, ok2 := m[unit]; ok2 {
			return v, true
		}
	}
	return 0, false
}

// valAny returns the metric's value under its lexically-smallest unit (deterministic) — used for
// per-share (eps) and share-count facts, which are not row-currency denominated.
func valAny(a *periodAgg, metric string) (float64, bool) {
	m, ok := a.vals[metric]
	if !ok || len(m) == 0 {
		return 0, false
	}
	best, first := "", true
	for u := range m {
		if first || u < best {
			best, first = u, false
		}
	}
	return m[best], true
}

// voteCurrency picks the row currency: the unit covering the most monetary facts, excluding
// compound per-share units and the "shares" count, with a lexical tiebreak so a dual-reporting
// CNY/USD filer resolves to CNY ("CNY" < "USD" — @AC-1). "USD" is the fallback for a period with
// no monetary fact at all.
func voteCurrency(a *periodAgg) string {
	unitCount := map[string]int{}
	for _, units := range a.vals {
		for u := range units {
			if strings.Contains(u, "/") || u == "shares" {
				continue
			}
			unitCount[u]++
		}
	}
	best, row := 0, "USD"
	for u, n := range unitCount {
		if n > best || (n == best && u < row) {
			best, row = n, u
		}
	}
	return row
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
	var niFacts []niFact // every NetIncomeLoss flow fact, for the quarterly TTM ROE (feature 222)

	for _, tags := range cf.Facts { // us-gaap, dei, ...
		for tag, entry := range tags {
			flowKey, isFlow := flowTags[tag]
			instKey, isInstant := instantTags[tag]
			if !isFlow && !isInstant {
				continue
			}
			for unitKey, unit := range entry.Units {
				for _, d := range unit {
					if flowKey == "net_income" && isFlow {
						if f, ok := toNIFact(d, unitKey); ok {
							niFacts = append(niFacts, f)
						}
					}
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
						agg = &periodAgg{fy: d.FY, fp: d.FP, periodType: ptype, periodEnd: end, filed: filed, vals: map[string]map[string]float64{}}
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
					// First-seen per (metric, unit): the XBRL unit key is load-bearing for the row
					// currency (feature 211) — a re-backfill re-derives the same currency deterministically.
					if agg.vals[name] == nil {
						agg.vals[name] = map[string]float64{}
					}
					if _, seen := agg.vals[name][unitKey]; !seen {
						agg.vals[name][unitKey] = d.Val
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
		p := buildPeriod(symbol, a)
		annualizeQuarterlyROE(&p, a, niFacts)
		out = append(out, p)
	}
	return out, nil
}

// niFact is one NetIncomeLoss flow fact keyed by its own period (not the filing's fy/fp, which a
// comparative column shares with the current one).
type niFact struct {
	start, end, filed time.Time
	unit              string
	val               float64
}

func toNIFact(d unitDatum, unit string) (niFact, bool) {
	start, ok1 := parseDate(d.Start)
	end, ok2 := parseDate(d.End)
	filed, ok3 := parseDate(d.Filed)
	if !ok1 || !ok2 || !ok3 {
		return niFact{}, false
	}
	return niFact{start: start, end: end, filed: filed, unit: unit, val: d.Val}, true
}

func spanDays(f niFact) int { return int(f.end.Sub(f.start).Hours()/24) + 1 }

// ttmWindowDays bounds the four quarter-ends a TTM sums: ends within (periodEnd − 350d, periodEnd].
const ttmWindowDays = 350

// trailingNetIncome sums the quarterly net income for up to four quarters ending at periodEnd, using
// only facts filed on/before cutoff (PIT) in the given unit; each quarter keeps its earliest filing.
// A missing standalone Q4 is derived as FY − the three in-year quarters. Returns (sum, quarters).
func trailingNetIncome(facts []niFact, unit string, periodEnd, cutoff time.Time) (float64, int) {
	type q struct {
		val   float64
		filed time.Time
	}
	quarters := map[time.Time]q{}
	var annuals []niFact
	for _, f := range facts {
		if f.unit != unit || f.filed.After(cutoff) {
			continue
		}
		days := spanDays(f)
		switch {
		case days >= quarterMinDays && days <= quarterMaxDays:
			if cur, ok := quarters[f.end]; !ok || f.filed.Before(cur.filed) {
				quarters[f.end] = q{f.val, f.filed}
			}
		case days >= annualMinDays && days <= annualMaxDays:
			annuals = append(annuals, f)
		}
	}
	// Earliest-filed annual per fiscal-year end, then derive the missing Q4s.
	fy := map[time.Time]niFact{}
	for _, a := range annuals {
		if cur, ok := fy[a.end]; !ok || a.filed.Before(cur.filed) {
			fy[a.end] = a
		}
	}
	for end, a := range fy {
		if _, ok := quarters[end]; ok {
			continue
		}
		sum, n := 0.0, 0
		for qEnd, qv := range quarters {
			if qEnd.After(a.start) && qEnd.Before(end) {
				sum += qv.val
				n++
			}
		}
		if n == 3 {
			quarters[end] = q{a.val - sum, a.filed}
		}
	}
	windowStart := periodEnd.AddDate(0, 0, -ttmWindowDays)
	var ends []time.Time
	for end := range quarters {
		if end.After(windowStart) && !end.After(periodEnd) {
			ends = append(ends, end)
		}
	}
	sort.Slice(ends, func(i, j int) bool { return ends[i].After(ends[j]) })
	if len(ends) > 4 {
		ends = ends[:4]
	}
	total := 0.0
	for _, e := range ends {
		total += quarters[e].val
	}
	return total, len(ends)
}

// annualizeQuarterlyROE puts a quarterly period's ROE on a trailing-twelve-month basis (feature 222),
// commensurable with annual rows and the TTM P/E on the same row: TTM net income / period-end equity;
// with n<4 quarters available, Σ × 4/n. Annual periods keep net_income / equity.
func annualizeQuarterlyROE(p *source.HistoricalFundamentalsPeriod, a *periodAgg, facts []niFact) {
	if a.periodType != "quarterly" {
		return
	}
	eq, ok := valIn(a, "stockholders_equity", p.Currency)
	if !ok || eq == 0 {
		return
	}
	sum, n := trailingNetIncome(facts, p.Currency, a.periodEnd, a.filed)
	if n == 0 {
		ni, ok := valIn(a, "net_income", p.Currency)
		if !ok {
			return
		}
		sum, n = ni, 1
	}
	roe := sum * 4 / float64(n) / eq
	p.ROE = &roe
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

// DerivationVersion MUST be bumped whenever buildPeriod / annualizeQuarterlyROE change a stored
// column's semantics — stored rows re-derive only when their version is lower (feature 223).
// 1 = feature 211 financial-debt D/E + feature 222 TTM quarterly ROE.
const DerivationVersion = 1

func buildPeriod(symbol string, a *periodAgg) source.HistoricalFundamentalsPeriod {
	p := source.HistoricalFundamentalsPeriod{
		DerivationVersion: DerivationVersion,
		Symbol:            symbol,
		FiscalPeriod:      fmt.Sprintf("%s-%d", a.fp, a.fy),
		PeriodType:        a.periodType,
		PeriodEnd:         a.periodEnd,
		FiledDate:         a.filed,
		ExtraMetrics:      map[string]float64{},
		Currency:          "USD",
		Source:            "edgar",
	}
	if a.fp == "FY" {
		p.FiscalPeriod = fmt.Sprintf("FY%d", a.fy)
	}
	// Row currency: the unit covering the most monetary facts (per-share/shares excluded), lexical
	// tiebreak — @AC-1. Absolute facts below are read in this native currency only (single-currency).
	rowCurrency := voteCurrency(a)
	p.Currency = rowCurrency
	setPtr := func(dst **float64, key string) {
		if v, ok := valAny(a, key); ok { // eps/shares are not row-currency denominated
			vv := v
			*dst = &vv
		}
	}
	setPtr(&p.EPS, "eps")
	if p.EPS == nil {
		setPtr(&p.EPS, "eps_basic")
	}
	setPtr(&p.SharesOutstanding, "shares")
	// Derived ratios (statement-native, PIT-safe): roe = net_income/equity (quarterly rows are then
	// re-based to TTM by annualizeQuarterlyROE), d/e = financial debt/equity.
	if ni, ok := valIn(a, "net_income", rowCurrency); ok {
		if eq, ok2 := valIn(a, "stockholders_equity", rowCurrency); ok2 && eq != 0 {
			roe := ni / eq
			p.ROE = &roe
		}
	}
	// Financial-debt D/E (feature 211, FR-2): total_debt / equity, native currency, no double-count.
	// LongTermDebtNoncurrent+Current when either is present (AAPL), else the aggregate LongTermDebt
	// (AXP); plus short-term/current/commercial-paper/convertible. Nil (→ missing) when no debt tag
	// is present — never a fabricated 0 (@AC-22 @feature-204).
	addOpt := func(key string) (float64, bool) { return valIn(a, key, rowCurrency) }
	sum := func(v float64, ok bool) float64 {
		if ok {
			return v
		}
		return 0
	}
	ltdNC, okNC := addOpt("long_term_debt_noncurrent")
	ltdC, okC := addOpt("long_term_debt_current")
	ltd, ltdOK := 0.0, false
	if okNC || okC {
		ltd, ltdOK = ltdNC+ltdC, true
	} else if v, ok := addOpt("long_term_debt"); ok {
		ltd, ltdOK = v, true
	}
	stb, okStb := addOpt("short_term_borrowings")
	dc, okDc := addOpt("debt_current")
	cp, okCp := addOpt("commercial_paper")
	cd, okCd := addOpt("convertible_debt_noncurrent")
	if ltdOK || okStb || okDc || okCp || okCd {
		totalDebt := ltd + sum(stb, okStb) + sum(dc, okDc) + sum(cp, okCp) + sum(cd, okCd)
		p.ExtraMetrics["total_debt"] = totalDebt
		if eq, ok := valIn(a, "stockholders_equity", rowCurrency); ok && eq != 0 {
			de := totalDebt / eq
			p.DebtToEquity = &de
		}
	}
	// Statement line items that have no canonical metric field spill into extra_metrics (native currency).
	for _, k := range []string{"revenue", "net_income", "assets", "liabilities", "stockholders_equity"} {
		if v, ok := valIn(a, k, rowCurrency); ok {
			p.ExtraMetrics[k] = v
		}
	}
	// USD-unit equity retained for the currency-consistent P/B step (feature 211, Step 6).
	if v, ok := valIn(a, "stockholders_equity", "USD"); ok {
		p.ExtraMetrics["stockholders_equity_usd"] = v
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
