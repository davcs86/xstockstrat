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
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/telemetry"
)

// defaultTickerURL is where SEC hosts the ticker→CIK map (NOT under data.sec.gov).
const defaultTickerURL = "https://www.sec.gov/files/company_tickers.json"

// Client fetches historical fundamentals from SEC EDGAR XBRL companyfacts.
type Client struct {
	settings  func() Settings
	tickerURL string
	hc        *http.Client

	rateMu   sync.Mutex
	lastCall time.Time

	cikMu    sync.RWMutex
	cikCache map[string]string // upper ticker → zero-padded 10-digit CIK
}

// Settings are the EDGAR connection settings, read on every request. RateLimitRPS <= 0 disables
// rate limiting; an empty BaseURL means https://data.sec.gov.
type Settings struct {
	BaseURL      string
	UserAgent    string
	RateLimitRPS int
}

// NewClient builds an EDGAR client with fixed settings.
func NewClient(baseURL, userAgent string, rateLimitRPS int) *Client {
	s := Settings{BaseURL: baseURL, UserAgent: userAgent, RateLimitRPS: rateLimitRPS}
	return NewLiveClient(func() Settings { return s })
}

// NewLiveClient builds an EDGAR client whose settings are re-read on every request.
func NewLiveClient(settings func() Settings) *Client {
	return &Client{
		settings:  settings,
		tickerURL: defaultTickerURL,
		hc:        &http.Client{Timeout: 30 * time.Second},
		cikCache:  make(map[string]string),
	}
}

func (c *Client) baseURL() string {
	if base := strings.TrimRight(c.settings().BaseURL, "/"); base != "" {
		return base
	}
	return "https://data.sec.gov"
}

// throttle enforces the configured minimum spacing between outbound SEC calls.
func (c *Client) throttle() {
	rps := c.settings().RateLimitRPS
	if rps <= 0 {
		return
	}
	minInterval := time.Second / time.Duration(rps)
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	if wait := minInterval - time.Since(c.lastCall); wait > 0 {
		time.Sleep(wait)
	}
	c.lastCall = time.Now()
}

func (c *Client) get(ctx context.Context, url string, out any) error {
	c.throttle()
	outcome, sentAt := telemetry.VendorBuild, time.Time{}
	defer func() { telemetry.RecordVendorRequest(ctx, telemetry.VendorEdgar, c.edgarOp(url), outcome, sentAt) }()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	// SEC fair-use requires a descriptive User-Agent; a missing one gets 403.
	req.Header.Set("User-Agent", c.settings().UserAgent)
	// Never set Accept-Encoding here: doing so disables net/http's transparent gzip decompression,
	// and SEC's CDN serves gzip — the raw compressed body would then fail JSON decode ('\x1f').
	outcome, sentAt = telemetry.VendorTransport, time.Now()
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		outcome = telemetry.HTTPErrorOutcome(resp.StatusCode)
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("edgar GET %s: status %d: %s", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	outcome = telemetry.VendorDecode
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return err
	}
	outcome = telemetry.VendorOK
	return nil
}

func (c *Client) edgarOp(url string) string {
	switch {
	case url == c.tickerURL:
		return "tickers"
	case strings.Contains(url, "/api/xbrl/companyfacts/"):
		return "companyfacts"
	}
	return telemetry.Other
}

// --- SEC companyfacts JSON shapes ---

type tickerEntry struct {
	CIK    json.Number `json:"cik_str"`
	Ticker string      `json:"ticker"`
}

type companyFacts struct {
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
	accn       string
	label      string
	periodType string
	periodEnd  time.Time
	filed      time.Time
	vals       map[string]map[string]float64 // metric → XBRL unit code (USD/CNY/USD-per-shares) → own-period value (shares: first-seen)
	flows      candSet
	instants   candSet
}

// candidate is one fact of a filing bucket keyed by its own period end (feature 340).
type candidate struct {
	val   float64
	filed time.Time
	tag   string
}

// candSet is metric → unit → own period end → candidate.
type candSet map[string]map[string]map[time.Time]candidate

// anchorKeys are the balance-sheet instants that date a bucket; share-count and dei facts never do.
var anchorKeys = []string{"stockholders_equity", "assets", "liabilities"}

// tagRank orders same-end candidates of one metric: Revenues beats the contract-revenue tag (D-15).
func tagRank(tag string) int {
	if tag == "Revenues" {
		return 0
	}
	return 1
}

func (s candSet) add(metric, unit, tag string, end, filed time.Time, val float64) {
	if s[metric] == nil {
		s[metric] = map[string]map[time.Time]candidate{}
	}
	if s[metric][unit] == nil {
		s[metric][unit] = map[time.Time]candidate{}
	}
	cur, ok := s[metric][unit][end]
	r, cr := tagRank(tag), tagRank(cur.tag)
	if !ok || r < cr || (r == cr && filed.Before(cur.filed)) {
		s[metric][unit][end] = candidate{val: val, filed: filed, tag: tag}
	}
}

// putAt writes the metric's candidate at end, per unit, into vals; a unit with none stays absent.
func (s candSet) putAt(a *periodAgg, metric string, end time.Time) {
	for unit, byEnd := range s[metric] {
		if c, ok := byEnd[end]; ok {
			if a.vals[metric] == nil {
				a.vals[metric] = map[string]float64{}
			}
			a.vals[metric][unit] = c.val
		}
	}
}

func latestEnd(s candSet, metrics ...string) (time.Time, bool) {
	var best time.Time
	found := false
	for _, m := range metrics {
		for _, byEnd := range s[m] {
			for end := range byEnd {
				if !found || end.After(best) {
					best, found = end, true
				}
			}
		}
	}
	return best, found
}

// selectOwnPeriod keeps, per unit, only facts dated at the bucket's balance-sheet anchor; with no
// anchor, instants are absent and each flow is read at its own latest end. No fallback (D-3, D-4).
func selectOwnPeriod(a *periodAgg) {
	anchor, hasAnchor := latestEnd(a.instants, anchorKeys...)
	if hasAnchor {
		for metric := range a.instants {
			a.instants.putAt(a, metric, anchor)
		}
	}
	for metric := range a.flows {
		at, ok := anchor, hasAnchor
		if !hasAnchor {
			at, ok = latestEnd(a.flows, metric)
		}
		if ok {
			a.flows.putAt(a, metric, at)
		}
	}
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

const (
	periodQuarterly = source.PeriodQuarterly
	periodAnnual    = source.PeriodAnnual
	sharesKey       = "shares"
	deiTaxonomy     = "dei"
)

// formClass maps a periodic-report form to its period type; a form not listed yields no period.
var formClass = map[string]string{
	"10-K": periodAnnual, "10-K/A": periodAnnual, "10-KT": periodAnnual, "10-KT/A": periodAnnual,
	"20-F": periodAnnual, "20-F/A": periodAnnual, "40-F": periodAnnual, "40-F/A": periodAnnual,
	"10-Q": periodQuarterly, "10-Q/A": periodQuarterly, "6-K": periodQuarterly, "6-K/A": periodQuarterly,
}

// Derivation is the full derived history of one filer plus what the audit reports about it.
type Derivation struct {
	Periods             []source.HistoricalFundamentalsPeriod
	LeftOut             []source.LeftOutPeriod
	SingleMetricAnchors int
}

type shareFact struct {
	end time.Time
	dei bool
	val float64
}

// filing is one accession's facts of the read tags.
type filing struct {
	accn     string
	form     string
	filedRaw string
	filed    time.Time
	mixed    bool // facts disagree on form or filed
	flows    candSet
	instants candSet
	shares   map[string]shareFact // unit → chosen cover-page or balance-sheet share count
}

func (f *filing) addShares(unit string, c shareFact) {
	cur, ok := f.shares[unit]
	switch {
	case !ok, c.end.After(cur.end):
	case !c.end.Equal(cur.end):
		return
	case c.dei != cur.dei:
		if !c.dei {
			return
		}
	case c.val <= cur.val:
		return
	}
	f.shares[unit] = c
}

func inClassDuration(class string, start, end time.Time) bool {
	days := int(end.Sub(start).Hours()/24) + 1
	if class == periodAnnual {
		return days >= annualMinDays && days <= annualMaxDays
	}
	return days >= quarterMinDays && days <= quarterMaxDays
}

// collectFilings groups the read facts by accession and returns every NetIncomeLoss flow fact.
func collectFilings(cf companyFacts) (map[string]*filing, []niFact) {
	filings := map[string]*filing{}
	var niFacts []niFact
	for taxonomy, tags := range cf.Facts {
		for tag, entry := range tags {
			flowKey, isFlow := flowTags[tag]
			instKey, isInstant := instantTags[tag]
			if !isFlow && !isInstant {
				continue
			}
			for unitKey, unit := range entry.Units {
				for _, d := range unit {
					if flowKey == "net_income" && isFlow {
						if nf, ok := toNIFact(d, unitKey); ok {
							niFacts = append(niFacts, nf)
						}
					}
					end, ok := parseDate(d.End)
					if !ok {
						continue
					}
					filed, ok := parseDate(d.Filed)
					if !ok {
						continue
					}
					f := filings[d.Accn]
					if f == nil {
						f = &filing{accn: d.Accn, form: d.Form, filedRaw: d.Filed, filed: filed, flows: candSet{}, instants: candSet{}, shares: map[string]shareFact{}}
						filings[d.Accn] = f
					}
					if d.Form != f.form || d.Filed != f.filedRaw {
						f.mixed = true
						continue
					}
					class := formClass[f.form]
					switch {
					case class == "":
					case isFlow:
						if start, ok := parseDate(d.Start); ok && inClassDuration(class, start, end) {
							f.flows.add(flowKey, unitKey, tag, end, filed, d.Val)
						}
					case end.After(filed):
					case instKey == sharesKey:
						f.addShares(unitKey, shareFact{end: end, dei: taxonomy == deiTaxonomy, val: d.Val})
					default:
						f.instants.add(instKey, unitKey, tag, end, filed, d.Val)
					}
				}
			}
		}
	}
	return filings, niFacts
}

func metricKeys(s candSet) []string {
	keys := make([]string, 0, len(s))
	for k := range s {
		keys = append(keys, k)
	}
	return keys
}

// ownPeriod turns a filing into its own period; ok=false when it has neither an anchor nor a flow.
func (f *filing) ownPeriod() (a *periodAgg, singleMetricAnchor, ok bool) {
	end, anchored := latestEnd(f.instants, anchorKeys...)
	if !anchored {
		if end, ok = latestEnd(f.flows, metricKeys(f.flows)...); !ok {
			return nil, false, false
		}
	}
	a = &periodAgg{accn: f.accn, periodType: formClass[f.form], periodEnd: end, filed: f.filed, vals: map[string]map[string]float64{}, flows: f.flows, instants: f.instants}
	selectOwnPeriod(a)
	for unit, sf := range f.shares {
		if a.vals[sharesKey] == nil {
			a.vals[sharesKey] = map[string]float64{}
		}
		a.vals[sharesKey][unit] = sf.val
	}
	atAnchor := 0
	for _, k := range anchorKeys {
		for _, byEnd := range f.instants[k] {
			if _, has := byEnd[end]; has {
				atAnchor++
				break
			}
		}
	}
	return a, anchored && atAnchor == 1, true
}

const (
	daysPerQuarter  = 91.3125
	fiscalYearShift = -15 // days: a 52/53-week year ending in early January belongs to the prior year
)

func fiscalYear(boundary time.Time) int { return boundary.AddDate(0, 0, fiscalYearShift).Year() }

func quartersBetween(from, to time.Time) int {
	return int(math.Round(to.Sub(from).Hours() / 24 / daysPerQuarter))
}

// quarterLabel labels a quarter ending at end against the sorted fiscal-year boundaries; atBoundary
// reports that the quarter ends on a real boundary (never true for the Dec-31 fallback).
func quarterLabel(end time.Time, bounds []time.Time) (label string, atBoundary bool) {
	ref, fromBounds := time.Date(end.Year(), time.December, 31, 0, 0, 0, 0, time.UTC), false
	for _, b := range bounds {
		if !b.Before(end) && quartersBetween(end, b) <= 3 {
			ref, fromBounds = b, true
			break
		}
	}
	if !fromBounds && len(bounds) > 0 {
		ref, fromBounds = bounds[0], true
		for _, b := range bounds[1:] {
			if absDuration(b.Sub(end)) < absDuration(ref.Sub(end)) {
				ref = b
			}
		}
	}
	r := quartersBetween(end, ref)
	mod := ((r % 4) + 4) % 4 // floor arithmetic: Go's % and / truncate toward zero
	div := (r - mod) / 4
	return fmt.Sprintf("Q%d-%d", 4-mod, fiscalYear(ref)-div), fromBounds && ref.Equal(end)
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

type periodID struct {
	periodType string
	end        time.Time
}

func leftOut(a *periodAgg, reason string) source.LeftOutPeriod {
	return source.LeftOutPeriod{FiscalPeriod: a.label, PeriodType: a.periodType, PeriodEnd: a.periodEnd, FiledDate: a.filed, Reason: reason}
}

// labelPeriods labels every period and returns the kept ones plus those left out.
func labelPeriods(byID map[periodID]*periodAgg) (kept []*periodAgg, out []source.LeftOutPeriod) {
	all := make([]*periodAgg, 0, len(byID))
	var bounds []time.Time
	for id, a := range byID {
		all = append(all, a)
		if id.periodType == periodAnnual {
			bounds = append(bounds, id.end)
		}
	}
	sort.Slice(bounds, func(i, j int) bool { return bounds[i].Before(bounds[j]) })
	sort.Slice(all, func(i, j int) bool {
		if !all[i].periodEnd.Equal(all[j].periodEnd) {
			return all[i].periodEnd.Before(all[j].periodEnd)
		}
		return all[i].periodType < all[j].periodType
	})
	taken := map[string]bool{}
	for _, a := range all {
		if a.periodType == periodAnnual {
			a.label = fmt.Sprintf("FY%d", fiscalYear(a.periodEnd))
		} else {
			var atBoundary bool
			if a.label, atBoundary = quarterLabel(a.periodEnd, bounds); atBoundary {
				out = append(out, leftOut(a, telemetry.LeftOutYearEndQuarter))
				continue
			}
		}
		if key := a.periodType + "|" + a.label; taken[key] {
			out = append(out, leftOut(a, telemetry.LeftOutLabelCollision))
			continue
		} else {
			taken[key] = true
		}
		kept = append(kept, a)
	}
	return kept, out
}

// DeriveHistorical derives a filer's whole history: one period per filing's own (type, end), the
// earliest filing supplying values and filed_date. It logs and counts nothing about left-out periods.
func (c *Client) DeriveHistorical(ctx context.Context, symbol string) (Derivation, error) {
	cik, err := c.resolveCIK(ctx, symbol)
	if err != nil {
		return Derivation{}, err
	}
	var cf companyFacts
	url := fmt.Sprintf("%s/api/xbrl/companyfacts/CIK%s.json", c.baseURL(), cik)
	if err := c.get(ctx, url, &cf); err != nil {
		return Derivation{}, fmt.Errorf("companyfacts %s: %w", symbol, err)
	}
	filings, niFacts := collectFilings(cf)
	accns := make([]string, 0, len(filings))
	for accn := range filings {
		accns = append(accns, accn)
	}
	sort.Strings(accns)

	var d Derivation
	byID := map[periodID]*periodAgg{}
	for _, accn := range accns {
		f := filings[accn]
		if f.mixed {
			slog.WarnContext(ctx, "edgar: accession with mixed form or filed date yields no period", "symbol", symbol, "accession", accn)
			continue
		}
		if formClass[f.form] == "" {
			continue
		}
		a, single, ok := f.ownPeriod()
		if !ok {
			continue
		}
		if single {
			d.SingleMetricAnchors++
		}
		id := periodID{a.periodType, a.periodEnd}
		// accns is sorted, so on an equal filed date the smaller accession is already in place.
		if cur := byID[id]; cur == nil || a.filed.Before(cur.filed) {
			byID[id] = a
		}
	}
	kept, out := labelPeriods(byID)
	d.LeftOut = out
	d.Periods = make([]source.HistoricalFundamentalsPeriod, 0, len(kept))
	for _, a := range kept {
		p := buildPeriod(symbol, a)
		annualizeQuarterlyROE(&p, a, niFacts)
		d.Periods = append(d.Periods, p)
	}
	return d, nil
}

// FetchHistorical implements source.HistoricalFundamentalsSource: one companyfacts fetch yields the
// full point-in-time series; the type and period_end range filters apply after labelling.
func (c *Client) FetchHistorical(ctx context.Context, symbol string, from, to time.Time, periodTypes []string) ([]source.HistoricalFundamentalsPeriod, error) {
	d, err := c.DeriveHistorical(ctx, symbol)
	if err != nil {
		return nil, err
	}
	for _, lo := range d.LeftOut {
		slog.WarnContext(ctx, "edgar: period left out", "symbol", symbol, "fiscal_period", lo.FiscalPeriod, "period_type", lo.PeriodType,
			"period_end", lo.PeriodEnd.Format(time.DateOnly), "filed_date", lo.FiledDate.Format(time.DateOnly), "reason", lo.Reason)
		telemetry.RecordPeriodLeftOut(ctx, lo.Reason)
	}
	wantQuarterly, wantAnnual := source.PeriodTypesWanted(periodTypes)
	out := make([]source.HistoricalFundamentalsPeriod, 0, len(d.Periods))
	for _, p := range d.Periods {
		if (p.PeriodType == periodQuarterly && !wantQuarterly) || (p.PeriodType == periodAnnual && !wantAnnual) {
			continue
		}
		if !from.IsZero() && p.PeriodEnd.Before(from) {
			continue
		}
		if !to.IsZero() && p.PeriodEnd.After(to) {
			continue
		}
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

// DerivationVersion MUST be bumped whenever buildPeriod / annualizeQuarterlyROE change a stored
// column's semantics — stored rows re-derive only when their version is lower (feature 223).
// 1 = feature 211 financial-debt D/E + feature 222 TTM quarterly ROE.
// 2 = feature 340 own-period instants and flows (balance-sheet anchor, no first-seen comparatives).
const DerivationVersion = 3

func buildPeriod(symbol string, a *periodAgg) source.HistoricalFundamentalsPeriod {
	p := source.HistoricalFundamentalsPeriod{
		DerivationVersion: DerivationVersion,
		Symbol:            symbol,
		FiscalPeriod:      a.label,
		PeriodType:        a.periodType,
		PeriodEnd:         a.periodEnd,
		FiledDate:         a.filed,
		ExtraMetrics:      map[string]float64{},
		Currency:          "USD",
		Source:            "edgar",
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
	for _, k := range source.DerivationOwnedExtraKeys {
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

var _ source.HistoricalFundamentalsSource = (*Client)(nil)
