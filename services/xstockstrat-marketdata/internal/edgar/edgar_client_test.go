package edgar

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// roundTripFunc lets a test stand in for the SEC HTTP endpoints without any network.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func jsonResp(v any) *http.Response {
	b, _ := json.Marshal(v)
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(string(b))),
		Header:     make(http.Header),
	}
}

// period is a compact spec for building a canned companyfacts unit datum.
type period struct {
	fy         int
	fp         string
	start, end string
	filed      string
	form       string
	ni         float64 // NetIncomeLoss
	eps        float64 // EarningsPerShareDiluted
}

// cannedCompanyFacts builds a us-gaap companyfacts payload from period specs. NetIncomeLoss is a
// duration (flow) fact carrying start/end; EPS mirrors it in USD/shares.
func cannedCompanyFacts(periods []period) map[string]any {
	var niUnits, epsUnits []map[string]any
	for _, p := range periods {
		niUnits = append(niUnits, map[string]any{
			"start": p.start, "end": p.end, "val": p.ni, "accn": "x", "fy": p.fy, "fp": p.fp, "form": p.form, "filed": p.filed,
		})
		epsUnits = append(epsUnits, map[string]any{
			"start": p.start, "end": p.end, "val": p.eps, "accn": "x", "fy": p.fy, "fp": p.fp, "form": p.form, "filed": p.filed,
		})
	}
	return map[string]any{
		"cik":        320193,
		"entityName": "Apple Inc.",
		"facts": map[string]any{
			"us-gaap": map[string]any{
				"NetIncomeLoss":           map[string]any{"label": "Net Income", "units": map[string]any{"USD": niUnits}},
				"EarningsPerShareDiluted": map[string]any{"label": "EPS Diluted", "units": map[string]any{"USD/shares": epsUnits}},
			},
		},
	}
}

func newTestClient(periods []period) *Client {
	c := NewClient("https://data.sec.gov", "xstockstrat-test/1.0 (test@example.com)", 0)
	c.tickerURL = "https://www.sec.gov/files/company_tickers.json"
	c.hc = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "company_tickers.json") {
			return jsonResp(map[string]any{
				"0": map[string]any{"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
			}), nil
		}
		if strings.Contains(r.URL.Path, "companyfacts") {
			return jsonResp(cannedCompanyFacts(periods)), nil
		}
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("not found")), Header: make(http.Header)}, nil
	})}
	return c
}

// AC-1: an EDGAR filing maps to a point-in-time period with the right period_end, filed_date,
// period_type, and source.
func TestFetchHistorical_MapsFiledPeriod_AC1(t *testing.T) {
	// Apple fiscal Q1-2020 ended 2019-12-28, filed 2020-01-29.
	c := newTestClient([]period{
		{fy: 2020, fp: "Q1", start: "2019-09-29", end: "2019-12-28", filed: "2020-01-29", form: "10-Q", ni: 22236e6, eps: 4.99},
	})
	periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"both"})
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	if len(periods) != 1 {
		t.Fatalf("want 1 period, got %d", len(periods))
	}
	p := periods[0]
	if got := p.PeriodEnd.Format("2006-01-02"); got != "2019-12-28" {
		t.Errorf("period_end = %s, want 2019-12-28", got)
	}
	if got := p.FiledDate.Format("2006-01-02"); got != "2020-01-29" {
		t.Errorf("filed_date = %s, want 2020-01-29", got)
	}
	if p.PeriodType != "quarterly" {
		t.Errorf("period_type = %q, want quarterly", p.PeriodType)
	}
	if p.FiscalPeriod != "Q1-2020" {
		t.Errorf("fiscal_period = %q, want Q1-2020", p.FiscalPeriod)
	}
	if p.Source != "edgar" {
		t.Errorf("source = %q, want edgar", p.Source)
	}
	if p.EPS == nil || *p.EPS != 4.99 {
		t.Errorf("eps = %v, want 4.99", p.EPS)
	}
}

// AC-2: both quarterly and annual periods are retained (a real time series), none dropped.
func TestFetchHistorical_QuarterlyAndAnnual_AC2(t *testing.T) {
	specs := []period{
		// 8 quarterly (fp Q1-Q3; Q4 folds into the FY filing) across 2019-2021
		{fy: 2019, fp: "Q1", start: "2018-09-30", end: "2018-12-29", filed: "2019-01-30", form: "10-Q", eps: 1.1},
		{fy: 2019, fp: "Q2", start: "2018-12-30", end: "2019-03-30", filed: "2019-05-01", form: "10-Q", eps: 1.2},
		{fy: 2019, fp: "Q3", start: "2019-03-31", end: "2019-06-29", filed: "2019-07-31", form: "10-Q", eps: 1.3},
		{fy: 2020, fp: "Q1", start: "2019-09-29", end: "2019-12-28", filed: "2020-01-29", form: "10-Q", eps: 1.4},
		{fy: 2020, fp: "Q2", start: "2019-12-29", end: "2020-03-28", filed: "2020-05-01", form: "10-Q", eps: 1.5},
		{fy: 2020, fp: "Q3", start: "2020-03-29", end: "2020-06-27", filed: "2020-07-31", form: "10-Q", eps: 1.6},
		{fy: 2021, fp: "Q1", start: "2020-09-27", end: "2020-12-26", filed: "2021-01-28", form: "10-Q", eps: 1.7},
		{fy: 2021, fp: "Q2", start: "2020-12-27", end: "2021-03-27", filed: "2021-04-29", form: "10-Q", eps: 1.8},
		// 3 annual (fp FY, ~365-day duration)
		{fy: 2018, fp: "FY", start: "2017-10-01", end: "2018-09-29", filed: "2018-11-05", form: "10-K", eps: 11.9},
		{fy: 2019, fp: "FY", start: "2018-09-30", end: "2019-09-28", filed: "2019-10-31", form: "10-K", eps: 11.8},
		{fy: 2020, fp: "FY", start: "2019-09-29", end: "2020-09-26", filed: "2020-10-30", form: "10-K", eps: 3.28},
	}
	c := newTestClient(specs)
	periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"both"})
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	var q, a int
	for _, p := range periods {
		switch p.PeriodType {
		case "quarterly":
			q++
		case "annual":
			a++
		}
	}
	if q != 8 {
		t.Errorf("quarterly periods = %d, want 8", q)
	}
	if a != 3 {
		t.Errorf("annual periods = %d, want 3", a)
	}
}

// Regression (feature 198 defect): SEC's CDN serves gzip-encoded bodies. The client must
// transparently decode them — a raw gzip body fails JSON decode with "invalid character '\x1f'"
// (0x1f is the gzip magic). This exercises the REAL http.Transport (via httptest), because
// transparent decompression is a Transport property the roundTripFunc mocks above bypass. Setting
// Accept-Encoding manually disables that decompression, which is the bug this guards.
func TestGet_TransparentlyDecodesGzip(t *testing.T) {
	payload := map[string]any{
		"0": map[string]any{"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
	}
	raw, _ := json.Marshal(payload)
	var gzbuf bytes.Buffer
	gw := gzip.NewWriter(&gzbuf)
	if _, err := gw.Write(raw); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	gzBody := gzbuf.Bytes()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// Mirror SEC's CDN: hand back a gzip-encoded body with Content-Encoding: gzip.
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(gzBody)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "xstockstrat-test/1.0 (test@example.com)", 0)
	c.tickerURL = srv.URL + "/files/company_tickers.json"

	cik, err := c.resolveCIK(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("resolveCIK against gzip endpoint: %v", err)
	}
	if cik != "0000320193" {
		t.Errorf("cik = %q, want 0000320193", cik)
	}
}

// A YTD (6-month) NetIncomeLoss on a Q2 filing must NOT become a quarterly period (wrong duration).
func TestFetchHistorical_RejectsYTDDuration(t *testing.T) {
	c := newTestClient([]period{
		{fy: 2020, fp: "Q2", start: "2019-12-29", end: "2020-03-28", filed: "2020-05-01", form: "10-Q", eps: 1.5}, // ~90d quarter
	})
	// Inject a 6-month YTD duration for the same fp by hand via a second client payload.
	c2 := NewClient("https://data.sec.gov", "t/1.0 (t@e.com)", 0)
	c2.hc = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "company_tickers.json") {
			return jsonResp(map[string]any{"0": map[string]any{"cik_str": 320193, "ticker": "AAPL"}}), nil
		}
		return jsonResp(map[string]any{
			"cik": 320193, "entityName": "Apple Inc.",
			"facts": map[string]any{"us-gaap": map[string]any{
				"NetIncomeLoss": map[string]any{"units": map[string]any{"USD": []map[string]any{
					{"start": "2019-09-29", "end": "2020-03-28", "val": 1.0, "fy": 2020, "fp": "Q2", "form": "10-Q", "filed": "2020-05-01"}, // ~181d YTD
				}}},
			}},
		}), nil
	})}
	if _, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil); err != nil {
		t.Fatalf("baseline fetch: %v", err)
	}
	periods, err := c2.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatalf("ytd fetch: %v", err)
	}
	if len(periods) != 0 {
		t.Errorf("YTD 6-month duration must be rejected, got %d periods", len(periods))
	}
}

// --- feature 211: currency capture from the XBRL unit key (@AC-1) ---

// instantFact211 builds an instant (balance-sheet) FY datum — no "start", so classifyPeriodType
// treats it as annual.
func instantFact211(fy int, end, filed string, val float64) map[string]any {
	return map[string]any{"end": end, "val": val, "accn": "x", "fy": fy, "fp": "FY", "form": "10-K", "filed": filed}
}

func newTestClientCF211(cf map[string]any) *Client {
	c := NewClient("https://data.sec.gov", "xstockstrat-test/1.0 (test@example.com)", 0)
	c.tickerURL = "https://www.sec.gov/files/company_tickers.json"
	c.hc = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "company_tickers.json") {
			return jsonResp(map[string]any{"0": map[string]any{"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}}), nil
		}
		if strings.Contains(r.URL.Path, "companyfacts") {
			return jsonResp(cf), nil
		}
		return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader("not found")), Header: make(http.Header)}, nil
	})}
	return c
}

// dualCurrencyCF is a CNY-native filer that also publishes a USD convenience translation for its
// monetary facts; EPS is per-share (USD/shares). Equal CNY/USD monetary-fact counts → lexical
// tiebreak → CNY.
func dualCurrencyCF() map[string]any {
	return map[string]any{
		"cik": 320193, "entityName": "Alibaba",
		"facts": map[string]any{"us-gaap": map[string]any{
			"StockholdersEquity": map[string]any{"units": map[string]any{
				"CNY": []map[string]any{instantFact211(2024, "2024-03-31", "2024-05-01", 1060886e6)},
				"USD": []map[string]any{instantFact211(2024, "2024-03-31", "2024-05-01", 153796e6)},
			}},
			"Liabilities": map[string]any{"units": map[string]any{
				"CNY": []map[string]any{instantFact211(2024, "2024-03-31", "2024-05-01", 783300e6)},
				"USD": []map[string]any{instantFact211(2024, "2024-03-31", "2024-05-01", 113555e6)},
			}},
			"EarningsPerShareDiluted": map[string]any{"units": map[string]any{
				"USD/shares": []map[string]any{{"start": "2023-04-01", "end": "2024-03-31", "val": 5.0, "accn": "x", "fy": 2024, "fp": "FY", "form": "10-K", "filed": "2024-05-01"}},
			}},
		}},
	}
}

func TestFetchHistorical_CurrencyFromUnitKey_AC1_feature211(t *testing.T) {
	c := newTestClientCF211(dualCurrencyCF())
	periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"annual"})
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	if len(periods) != 1 {
		t.Fatalf("want 1 period, got %d", len(periods))
	}
	p := periods[0]
	if p.Currency != "CNY" {
		t.Errorf("currency = %q, want CNY (dual-report native, lexical tiebreak)", p.Currency)
	}
	if got := p.ExtraMetrics["stockholders_equity"]; got != 1060886e6 {
		t.Errorf("native equity = %v, want CNY 1060886e6", got)
	}
	if got := p.ExtraMetrics["stockholders_equity_usd"]; got != 153796e6 {
		t.Errorf("stockholders_equity_usd = %v, want 153796e6 (retained for P/B)", got)
	}
}

func TestFetchHistorical_CurrencyUSDOnly_feature211(t *testing.T) {
	cf := map[string]any{
		"cik": 320193, "entityName": "Apple",
		"facts": map[string]any{"us-gaap": map[string]any{
			"StockholdersEquity": map[string]any{"units": map[string]any{"USD": []map[string]any{instantFact211(2024, "2024-09-28", "2024-11-01", 56950e6)}}},
			"Liabilities":        map[string]any{"units": map[string]any{"USD": []map[string]any{instantFact211(2024, "2024-09-28", "2024-11-01", 308030e6)}}},
		}},
	}
	c := newTestClientCF211(cf)
	periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"annual"})
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	if len(periods) != 1 {
		t.Fatalf("want 1 period, got %d", len(periods))
	}
	if periods[0].Currency != "USD" {
		t.Errorf("currency = %q, want USD (single-currency filer unchanged)", periods[0].Currency)
	}
}

func TestFetchHistorical_CurrencyDeterministic_feature211(t *testing.T) {
	c := newTestClientCF211(dualCurrencyCF())
	var first string
	for i := 0; i < 5; i++ {
		periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"annual"})
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		if len(periods) != 1 {
			t.Fatalf("run %d: want 1 period, got %d", i, len(periods))
		}
		if i == 0 {
			first = periods[0].Currency
		} else if periods[0].Currency != first {
			t.Errorf("run %d currency = %q, want stable %q", i, periods[0].Currency, first)
		}
	}
	if first != "CNY" {
		t.Errorf("stable currency = %q, want CNY", first)
	}
}

// --- feature 211: financial-debt D/E (@AC-2, @AC-3) ---

// debtCF211 builds a USD-only FY filer with equity + arbitrary debt line items. The D/E ratio is
// currency-invariant, so USD fixtures suffice here (currency capture is covered by the @AC-1 tests).
func debtCF211(equity float64, debts map[string]float64) map[string]any {
	facts := map[string]any{
		"StockholdersEquity": map[string]any{"units": map[string]any{"USD": []map[string]any{instantFact211(2025, "2025-09-30", "2025-11-01", equity)}}},
	}
	for tag, v := range debts {
		facts[tag] = map[string]any{"units": map[string]any{"USD": []map[string]any{instantFact211(2025, "2025-09-30", "2025-11-01", v)}}}
	}
	return map[string]any{"cik": 320193, "entityName": "T", "facts": map[string]any{"us-gaap": facts}}
}

func onlyPeriodDE(t *testing.T, cf map[string]any) source.HistoricalFundamentalsPeriod {
	t.Helper()
	c := newTestClientCF211(cf)
	periods, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"annual"})
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	if len(periods) != 1 {
		t.Fatalf("want 1 period, got %d", len(periods))
	}
	return periods[0]
}

// @AC-2: BABA — financial-debt D/E (ConvertibleDebtNoncurrent 8,098M / equity 153,796M ≈ 0.053),
// NOT the total-liabilities ratio.
func TestDebtToEquity_FinancialDebtConvention_AC2_feature211(t *testing.T) {
	p := onlyPeriodDE(t, debtCF211(153796e6, map[string]float64{"ConvertibleDebtNoncurrent": 8098e6}))
	if p.DebtToEquity == nil {
		t.Fatalf("debt_to_equity nil, want ~0.053")
	}
	if de := *p.DebtToEquity; de < 0.045 || de > 0.06 {
		t.Errorf("debt_to_equity = %v, want ~0.053 (financial-debt convention)", de)
	}
	if td := p.ExtraMetrics["total_debt"]; td != 8098e6 {
		t.Errorf("total_debt = %v, want 8098e6", td)
	}
}

// @AC-3: AXP (financial-sector) — LongTermDebt 56,387M + ShortTermBorrowings 1,371M over equity
// 33,474M ≈ 1.73, below de_bad=2.0 → non-zero D/E sub-score (no longer permanently zeroed).
func TestDebtToEquity_FinancialSectorNonZero_AC3_feature211(t *testing.T) {
	p := onlyPeriodDE(t, debtCF211(33474e6, map[string]float64{"LongTermDebt": 56387e6, "ShortTermBorrowings": 1371e6}))
	if p.DebtToEquity == nil {
		t.Fatalf("debt_to_equity nil, want ~1.73")
	}
	de := *p.DebtToEquity
	if de < 1.70 || de > 1.75 {
		t.Errorf("debt_to_equity = %v, want ~1.73", de)
	}
	if de >= 2.0 {
		t.Errorf("debt_to_equity = %v, want < de_bad 2.0 (non-zero sub-score)", de)
	}
}

// AAPL — LongTermDebtNoncurrent+Current summed (no double-count vs aggregate LongTermDebt) + CommercialPaper.
func TestDebtToEquity_NoDoubleCount_feature211(t *testing.T) {
	p := onlyPeriodDE(t, debtCF211(73733e6, map[string]float64{
		"LongTermDebtNoncurrent": 78328e6,
		"LongTermDebtCurrent":    12350e6,
		"CommercialPaper":        7979e6,
	}))
	if td := p.ExtraMetrics["total_debt"]; td != 98657e6 {
		t.Errorf("total_debt = %v, want 98657e6 (78328+12350+7979, no aggregate double-count)", td)
	}
	if p.DebtToEquity == nil || *p.DebtToEquity < 1.33 || *p.DebtToEquity > 1.35 {
		t.Errorf("debt_to_equity = %v, want ~1.34", p.DebtToEquity)
	}
}

// No debt tag present → DebtToEquity nil (→ missing_metrics), never a fabricated 0 (@AC-22 @feature-204).
func TestDebtToEquity_NilWhenNoDebtTag_feature211(t *testing.T) {
	p := onlyPeriodDE(t, debtCF211(50000e6, map[string]float64{}))
	if p.DebtToEquity != nil {
		t.Errorf("debt_to_equity = %v, want nil (no debt tag present)", *p.DebtToEquity)
	}
	if _, ok := p.ExtraMetrics["total_debt"]; ok {
		t.Errorf("total_debt present, want absent when no debt tag")
	}
}
