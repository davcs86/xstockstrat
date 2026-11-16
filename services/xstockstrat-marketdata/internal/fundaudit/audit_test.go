package fundaudit

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/edgar"
	"github.com/xstockstrat/marketdata/internal/source"
)

func d(s string) time.Time {
	v, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return v
}

// The collided ORCL row in the shape query_fundamentals (historical mode) returns it: snake_case
// keys, RFC 3339 timestamps, a zero-valued field omitted, an unset column named in missing_metrics.
const orclCollidedJSON = `{
  "symbol": "ORCL", "fiscal_period": "Q1-2026", "period_type": "quarterly",
  "period_end": "2026-09-07T00:00:00Z", "filed_date": "2025-09-10T00:00:00Z",
  "market_cap": 310250000, "pb_ratio": 13.1, "price": 310.25,
  "extra_metrics": {"net_income": 4760000000, "stockholders_equity": 66772000000},
  "currency": "USD", "source": "edgar",
  "missing_metrics": ["pe_ratio", "eps", "beta", "roe", "debt_to_equity", "year_high", "year_low"]
}`

func parse(t *testing.T, doc string, version int) map[string][]source.HistoricalPriceState {
	t.Helper()
	rows, err := ParseRows(strings.NewReader(doc), version)
	if err != nil {
		t.Fatalf("ParseRows: %v", err)
	}
	return rows
}

func TestParseRows_QueryFundamentalsShape(t *testing.T) {
	rows := parse(t, `{"ORCL": [`+orclCollidedJSON+`], "NONE": []}`, 2)
	if len(rows) != 2 || len(rows["ORCL"]) != 1 || len(rows["NONE"]) != 0 {
		t.Fatalf("rows = %+v, want ORCL with one row and NONE with none", rows)
	}
	r := rows["ORCL"][0]
	if r.FiscalPeriod != "Q1-2026" || r.PeriodType != "quarterly" || !r.PeriodEnd.Equal(d("2026-09-07")) || !r.FiledDate.Equal(d("2025-09-10")) {
		t.Errorf("identity = %s %s %v %v", r.FiscalPeriod, r.PeriodType, r.PeriodEnd, r.FiledDate)
	}
	if r.PERatio != nil {
		t.Errorf("pe_ratio = %v, want nil (named in missing_metrics)", *r.PERatio)
	}
	if r.DividendYield == nil || *r.DividendYield != 0 {
		t.Errorf("dividend_yield = %v, want 0 (omitted as a zero value, not missing)", r.DividendYield)
	}
	if r.Price == nil || *r.Price != 310.25 || r.PBRatio == nil || *r.PBRatio != 13.1 || r.MarketCap == nil || *r.MarketCap != 310250000 {
		t.Errorf("price %v pb %v market_cap %v, want 310.25, 13.1, 310250000", r.Price, r.PBRatio, r.MarketCap)
	}
	if r.ExtraMetrics["net_income"] != 4760000000 || r.ExtraMetrics["stockholders_equity"] != 66772000000 {
		t.Errorf("extra_metrics = %v", r.ExtraMetrics)
	}
	if r.Currency != "USD" || r.DerivationVersion != 2 {
		t.Errorf("currency %q version %d, want USD and the version parameter 2", r.Currency, r.DerivationVersion)
	}
}

func TestParseRows_Errors(t *testing.T) {
	for name, doc := range map[string]string{
		"malformed date":  `{"ORCL": [{"fiscal_period": "Q1-2026", "period_type": "quarterly", "period_end": "2026-09-07", "filed_date": "2025-09-10T00:00:00Z"}]}`,
		"no filed_date":   `{"ORCL": [{"fiscal_period": "Q1-2026", "period_type": "quarterly", "period_end": "2026-09-07T00:00:00Z"}]}`,
		"not a rows file": `[1, 2]`,
	} {
		_, err := ParseRows(strings.NewReader(doc), 2)
		if err == nil || (name != "not a rows file" && !strings.Contains(err.Error(), "ORCL")) {
			t.Errorf("%s: err = %v, want an error naming the symbol", name, err)
		}
	}
}

type stubDeriver map[string]func() (edgar.Derivation, error)

func (s stubDeriver) DeriveHistorical(_ context.Context, symbol string) (edgar.Derivation, error) {
	return s[symbol]()
}

func fresh(label, ptype, end, filed string, extra map[string]float64) source.HistoricalFundamentalsPeriod {
	return source.HistoricalFundamentalsPeriod{FiscalPeriod: label, PeriodType: ptype, PeriodEnd: d(end), FiledDate: d(filed), DerivationVersion: 3, ExtraMetrics: extra}
}

func orclCorrected() (edgar.Derivation, error) {
	return edgar.Derivation{
		Periods: []source.HistoricalFundamentalsPeriod{
			fresh("Q1-2026", "quarterly", "2025-08-31", "2025-09-10", map[string]float64{"net_income": 2927000000, "stockholders_equity": 24154000000}),
			fresh("Q1-2027", "quarterly", "2026-08-31", "2026-09-11", map[string]float64{"net_income": 4760000000, "stockholders_equity": 66772000000}),
			fresh("FY2025", "annual", "2025-05-31", "2025-06-18", map[string]float64{"net_income": 12443000000}),
		},
		LeftOut:             []source.LeftOutPeriod{{FiscalPeriod: "Q4-2025", PeriodType: "quarterly", PeriodEnd: d("2025-05-31"), FiledDate: d("2025-06-18"), Reason: "year_end_quarter"}},
		SingleMetricAnchors: 2,
	}, nil
}

func symbolReport(t *testing.T, r Report, symbol string) SymbolReport {
	t.Helper()
	for _, s := range r.Symbols {
		if s.Symbol == symbol {
			return s
		}
	}
	t.Fatalf("no report for %s in %+v", symbol, r.Symbols)
	return SymbolReport{}
}

func TestPlan_PerSymbolReport(t *testing.T) {
	rows := parse(t, `{
	  "ORCL": [`+orclCollidedJSON+`,
	    {"fiscal_period": "FY2019", "period_type": "annual", "period_end": "2019-05-31T00:00:00Z", "filed_date": "2019-06-21T00:00:00Z", "extra_metrics": {"net_income": 11083000000}, "currency": "USD"},
	    {"fiscal_period": "Q4-2025", "period_type": "quarterly", "period_end": "2025-05-31T00:00:00Z", "filed_date": "2025-06-18T00:00:00Z", "currency": "USD"}],
	  "MOVED": [`+orclCollidedJSON+`],
	  "DOWN": [`+orclCollidedJSON+`],
	  "LATE": [`+orclCollidedJSON+`]
	}`, 2)
	late := func() (edgar.Derivation, error) {
		return edgar.Derivation{Periods: []source.HistoricalFundamentalsPeriod{
			fresh("Q1-2026", "quarterly", "2025-09-12", "2025-09-10", map[string]float64{"net_income": 4760000000}),
		}}, nil
	}
	report := Plan(context.Background(), stubDeriver{
		"ORCL": orclCorrected,
		"MOVED": func() (edgar.Derivation, error) {
			return edgar.Derivation{Periods: []source.HistoricalFundamentalsPeriod{
				fresh("Q1-2026", "quarterly", "2025-08-31", "2025-09-10", map[string]float64{"net_income": 100000000, "stockholders_equity": 900000000}),
			}}, nil
		},
		"DOWN": func() (edgar.Derivation, error) { return edgar.Derivation{}, errors.New("edgar GET: status 503") },
		"LATE": late,
	}, rows, 2)

	if got := fmt.Sprint(symbolNames(report)); got != "[DOWN LATE MOVED ORCL]" {
		t.Fatalf("symbols = %s, want every symbol planned, in order", got)
	}
	orcl := symbolReport(t, report, "ORCL")
	if orcl.Guard != "" || orcl.DeriveError != "" || orcl.Stored != 3 || orcl.Derived != 3 || orcl.Identical != 0 || orcl.Deletes != 3 || orcl.Inserts != 3 {
		t.Errorf("ORCL = %+v, want 3 stored, 3 derived, 0 identical, 3 deletes, 3 inserts and no guard", orcl)
	}
	// The collided row is replaced by the period filed the same day and is not listed. The annual
	// row's filing yields no annual period; the quarterly row is the period the derivation left out.
	wantDeleted := []DeletedRow{
		{FiscalPeriod: "FY2019", PeriodType: "annual", PeriodEnd: "2019-05-31", FiledDate: "2019-06-21", Category: "no_period_derived"},
		{FiscalPeriod: "Q4-2025", PeriodType: "quarterly", PeriodEnd: "2025-05-31", FiledDate: "2025-06-18", Category: "left_out"},
	}
	if !slices.Equal(orcl.DeletedWithoutReplacement, wantDeleted) {
		t.Errorf("ORCL deleted without replacement = %+v, want %+v", orcl.DeletedWithoutReplacement, wantDeleted)
	}
	if len(orcl.LeftOut) != 1 || orcl.LeftOut[0].Reason != "year_end_quarter" || orcl.LeftOut[0].PeriodEnd != "2025-05-31" || orcl.SingleMetricAnchors != 2 || orcl.DerivedEndAfterFiled != 0 {
		t.Errorf("ORCL left out %+v anchors %d end-after-filed %d", orcl.LeftOut, orcl.SingleMetricAnchors, orcl.DerivedEndAfterFiled)
	}
	if moved := symbolReport(t, report, "MOVED"); !strings.Contains(moved.Guard, "no stored reported value") || moved.Deletes != 0 || moved.Inserts != 0 {
		t.Errorf("MOVED = %+v, want the filer guard and no plan", moved)
	}
	if down := symbolReport(t, report, "DOWN"); !strings.Contains(down.DeriveError, "503") || down.Stored != 1 {
		t.Errorf("DOWN = %+v, want the derive error reported", down)
	}
	if got := symbolReport(t, report, "LATE").DerivedEndAfterFiled; got != 1 {
		t.Errorf("LATE derived periods ending after their filing = %d, want 1", got)
	}
	if report.DeletedWithoutReplacementByCategory["no_period_derived"] != 1 || report.DeletedWithoutReplacementByCategory["left_out"] != 1 || report.LeftOutByReason["year_end_quarter"] != 1 || report.StoredVersion != 2 {
		t.Errorf("lane summary = %v / %v / version %d", report.DeletedWithoutReplacementByCategory, report.LeftOutByReason, report.StoredVersion)
	}
	if report.Totals != (Totals{Rows: 6, EndAfterFiled: 4, DuplicatePeriodEnds: 0}) {
		t.Errorf("totals = %+v, want 6 rows, 4 ending after their filing, no duplicate period_end", report.Totals)
	}
}

func symbolNames(r Report) []string {
	out := []string{}
	for _, s := range r.Symbols {
		out = append(out, s.Symbol)
	}
	return out
}

// @AC-7: the post-repair verdict passes only when every pass condition holds.
func TestPostRepairVerdict_AC7_feature348(t *testing.T) {
	const repaired = `{"fiscal_period": "Q1-2026", "period_type": "quarterly", "period_end": "2025-08-31T00:00:00Z", "filed_date": "2025-09-10T00:00:00Z", "extra_metrics": {"net_income": 2927000000, "stockholders_equity": 24154000000}},
	  {"fiscal_period": "Q1-2027", "period_type": "quarterly", "period_end": "2026-08-31T00:00:00Z", "filed_date": "2026-09-11T00:00:00Z", "extra_metrics": {"net_income": 4760000000, "stockholders_equity": 66772000000}},
	  {"fiscal_period": "FY2025", "period_type": "annual", "period_end": "2025-05-31T00:00:00Z", "filed_date": "2025-06-18T00:00:00Z", "extra_metrics": {"net_income": 12443000000}}`
	const twin = `{"fiscal_period": "Q1-2099", "period_type": "quarterly", "period_end": "2025-08-31T00:00:00Z", "filed_date": "2025-09-10T00:00:00Z", "extra_metrics": {"net_income": 2927000000}}`
	deriver := stubDeriver{"ORCL": orclCorrected, "STALE": orclCorrected, "DOWN": func() (edgar.Derivation, error) { return edgar.Derivation{}, errors.New("status 503") }}
	for name, tc := range map[string]struct {
		doc      string
		failed   []string
		wantPass bool
		reason   string
	}{
		"clean lane":                                  {`{"ORCL": [` + repaired + `]}`, nil, true, ""},
		"a failed symbol still plans a change":        {`{"ORCL": [` + repaired + `], "STALE": [` + orclCollidedJSON + `]}`, []string{"STALE"}, false, "period_end after filed_date"},
		"a failed symbol plans a change, rows clean":  {`{"ORCL": [` + repaired + `], "STALE": [` + twin + `]}`, []string{"STALE"}, true, ""},
		"a symbol outside the failed list plans one":  {`{"ORCL": [` + repaired + `], "STALE": [` + twin + `]}`, nil, false, "STALE plans"},
		"a stored row ends after its filing":          {`{"ORCL": [` + orclCollidedJSON + `]}`, []string{"ORCL"}, false, "period_end after filed_date"},
		"two rows of one type share a period_end":     {`{"ORCL": [` + repaired + `, ` + twin + `]}`, []string{"ORCL"}, false, "share a period_end"},
		"a symbol outside the list cannot be planned": {`{"ORCL": [` + repaired + `], "DOWN": [` + twin + `]}`, nil, false, "DOWN could not be planned"},
	} {
		report := Plan(context.Background(), deriver, parse(t, tc.doc, 3), 3)
		v := PostRepairVerdict(report, tc.failed)
		if v.Pass != tc.wantPass || (tc.reason != "" && !strings.Contains(strings.Join(v.Reasons, "; "), tc.reason)) || (tc.wantPass && len(v.Reasons) != 0) {
			t.Errorf("%s: verdict = %+v, want pass=%v with a reason containing %q", name, v, tc.wantPass, tc.reason)
		}
	}
}

// @AC-11: the pre/post diff counts, per price-join column, the rows that went from a value to null.
func TestDiff_ValueToNull_AC11_feature348(t *testing.T) {
	pre := parse(t, `{"ORCL": [`+orclCollidedJSON+`,
	  {"fiscal_period": "FY2025", "period_type": "annual", "period_end": "2025-06-12T00:00:00Z", "filed_date": "2025-06-18T00:00:00Z", "price": 200, "pb_ratio": 20, "missing_metrics": ["market_cap", "pe_ratio", "dividend_yield"]},
	  {"fiscal_period": "FY2019", "period_type": "annual", "period_end": "2019-05-31T00:00:00Z", "filed_date": "2019-06-21T00:00:00Z", "price": 50},
	  {"fiscal_period": "Q2-2025", "period_type": "quarterly", "period_end": "2024-11-30T00:00:00Z", "filed_date": "2024-12-10T00:00:00Z", "price": 170},
	  {"fiscal_period": "Q2-2099", "period_type": "quarterly", "period_end": "2024-12-05T00:00:00Z", "filed_date": "2024-12-10T00:00:00Z", "price": 170},
	  {"fiscal_period": "FY2024", "period_type": "annual", "period_end": "2024-05-31T00:00:00Z", "filed_date": "2024-06-20T00:00:00Z", "price": 120}]}`, 2)
	post := parse(t, `{"ORCL": [
	  {"fiscal_period": "Q1-2026", "period_type": "quarterly", "period_end": "2025-08-31T00:00:00Z", "filed_date": "2025-09-10T00:00:00Z", "price": 310.25, "market_cap": 310250000, "missing_metrics": ["pe_ratio", "pb_ratio"]},
	  {"fiscal_period": "Q1-2027", "period_type": "quarterly", "period_end": "2026-08-31T00:00:00Z", "filed_date": "2026-09-11T00:00:00Z", "missing_metrics": ["price", "market_cap", "pe_ratio", "pb_ratio", "dividend_yield"]},
	  {"fiscal_period": "FY2025", "period_type": "annual", "period_end": "2025-05-31T00:00:00Z", "filed_date": "2025-06-18T00:00:00Z", "price": 201, "pb_ratio": 19, "missing_metrics": ["market_cap", "pe_ratio", "dividend_yield"]},
	  {"fiscal_period": "Q2-2025", "period_type": "quarterly", "period_end": "2024-11-30T00:00:00Z", "filed_date": "2024-12-10T00:00:00Z", "missing_metrics": ["price"]},
	  {"fiscal_period": "FY2024", "period_type": "annual", "period_end": "2024-05-31T00:00:00Z", "filed_date": "2024-06-20T00:00:00Z", "missing_metrics": ["price"]},
	  {"fiscal_period": "FY2098", "period_type": "annual", "period_end": "2024-06-05T00:00:00Z", "filed_date": "2024-06-20T00:00:00Z", "missing_metrics": ["price"]}]}`, 3)
	got := Diff(pre, post)
	want := DiffReport{
		// Only the row filed 2025-09-10 lost pb_ratio; pe_ratio was already unset before.
		ValueToNull:  map[string]int{"price": 0, "market_cap": 0, "pe_ratio": 0, "pb_ratio": 1, "dividend_yield": 0},
		Compared:     2, // filed 2025-09-10 and 2025-06-18
		Ambiguous:    2, // two pre rows filed 2024-12-10; two post rows filed 2024-06-20
		UnmatchedPre: 1, // FY2019 has no post row
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("Diff = %+v, want %+v", got, want)
	}
}
