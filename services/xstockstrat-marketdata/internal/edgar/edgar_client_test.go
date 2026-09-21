package edgar

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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
