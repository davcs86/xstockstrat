package edgar

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// --- feature 340: own-period selection in FetchHistorical ---

// lyftPeriods loads LYFT's SEC companyfacts (CIK0001759509, trimmed by tag only) and derives it.
func lyftPeriods(t *testing.T) []source.HistoricalFundamentalsPeriod {
	t.Helper()
	b, err := os.ReadFile("testdata/lyft_companyfacts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cf map[string]any
	if err := json.Unmarshal(b, &cf); err != nil {
		t.Fatal(err)
	}
	// newTestClientCF211 resolves only the AAPL ticker; the payload is LYFT's.
	periods, err := newTestClientCF211(cf).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	return periods
}

func assertROE(t *testing.T, p source.HistoricalFundamentalsPeriod, want float64, rounded string) {
	t.Helper()
	if p.ROE == nil {
		t.Fatalf("%s roe nil, want %.6f", p.FiscalPeriod, want)
	}
	if math.Abs(*p.ROE-want) > 1e-9 {
		t.Fatalf("%s roe = %.6f, want %.6f", p.FiscalPeriod, *p.ROE, want)
	}
	if got := formatRounded(*p.ROE); got != rounded {
		t.Fatalf("%s roe rounds to %s, want %s", p.FiscalPeriod, got, rounded)
	}
}

func formatRounded(v float64) string { b, _ := json.Marshal(math.Round(v*1e6) / 1e6); return string(b) }

// @AC-1: Q3-2026 TTM net income 2,809,866,000 over the quarter-end equity 2,980,873,000, not the
// first-seen 2024-12-31 comparative 767,016,000 (roe 3.6634).
func TestLYFT_QuarterlyROE_OwnPeriodEquity_AC1_feature340(t *testing.T) {
	p := periodByFP(t, lyftPeriods(t), "Q3-2026")
	if got := p.ExtraMetrics["stockholders_equity"]; got != 2980873000 {
		t.Fatalf("Q3-2026 stockholders_equity = %v, want 2980873000", got)
	}
	assertROE(t, p, 2809866000.0/2980873000.0, "0.942632")
}

// @AC-3: FY2025 net income 2,844,008,000 over the year-end equity 3,273,523,000.
func TestLYFT_AnnualROE_OwnPeriodEquity_AC3_feature340(t *testing.T) {
	assertROE(t, periodByFP(t, lyftPeriods(t), "FY2025"), 2844008000.0/3273523000.0, "0.868791")
}

// @AC-5: every period carries version 2, which re-derives a stored version-1 row.
func TestLYFT_PeriodsStampedVersion2_AC5_feature340(t *testing.T) {
	for _, p := range lyftPeriods(t) {
		if p.DerivationVersion != 2 {
			t.Fatalf("%s stamped version %d, want 2", p.FiscalPeriod, p.DerivationVersion)
		}
	}
}

// Synthetic Q3-2026 10-Q buckets (anchor = latest balance-sheet instant date).
func opFlow(start, end string, val float64) map[string]any {
	return map[string]any{"start": start, "end": end, "val": val, "accn": "x", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-11-06"}
}

func opInst(end string, val float64) map[string]any {
	return map[string]any{"end": end, "val": val, "accn": "x", "fy": 2026, "fp": "Q3", "form": "10-Q", "filed": "2026-11-06"}
}

func opQ3(t *testing.T, gaap map[string][]map[string]any) source.HistoricalFundamentalsPeriod {
	t.Helper()
	facts := map[string]any{}
	for tag, data := range gaap {
		facts[tag] = map[string]any{"units": map[string]any{"USD": data}}
	}
	cf := map[string]any{"cik": 320193, "entityName": "T", "facts": map[string]any{"us-gaap": facts}}
	periods, err := newTestClientCF211(cf).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return periodByFP(t, periods, "Q3-2026")
}

func TestOwnPeriod_SeveralEquityInstants_PeriodEndSelected_feature340(t *testing.T) {
	p := opQ3(t, map[string][]map[string]any{
		"StockholdersEquity": {opInst("2025-12-31", 100), opInst("2026-03-31", 150), opInst("2026-09-30", 400), opInst("2026-06-30", 300)},
		"NetIncomeLoss":      {opFlow("2026-07-01", "2026-09-30", 10)},
	})
	if got := p.ExtraMetrics["stockholders_equity"]; got != 400 {
		t.Fatalf("stockholders_equity = %v, want the period-end 400", got)
	}
	if p.ROE == nil || math.Abs(*p.ROE-10*4/400.0) > 1e-12 {
		t.Fatalf("roe = %v, want 0.1", p.ROE)
	}
}

func TestOwnPeriod_AnchorMiss_NilROEAndDE_feature340(t *testing.T) {
	p := opQ3(t, map[string][]map[string]any{
		"Assets":             {opInst("2026-09-30", 1000)},
		"StockholdersEquity": {opInst("2025-12-31", 100)},
		"LongTermDebt":       {opInst("2026-09-30", 50)},
		"NetIncomeLoss":      {opFlow("2026-07-01", "2026-09-30", 10)},
	})
	if p.ROE != nil || p.DebtToEquity != nil {
		t.Fatalf("roe = %v, d/e = %v, want both nil on an anchor miss", p.ROE, p.DebtToEquity)
	}
	if _, ok := p.ExtraMetrics["stockholders_equity"]; ok {
		t.Fatal("stockholders_equity present, want absent (no fallback to another date)")
	}
}

func TestOwnPeriod_FlowOnlyComparative_Absent_feature340(t *testing.T) {
	p := opQ3(t, map[string][]map[string]any{
		"StockholdersEquity": {opInst("2026-09-30", 400)},
		"NetIncomeLoss":      {opFlow("2025-07-01", "2025-09-30", 10)},
	})
	if _, ok := p.ExtraMetrics["net_income"]; ok {
		t.Fatalf("net_income = %v, want absent (only a prior-year comparative)", p.ExtraMetrics["net_income"])
	}
	if p.ROE != nil {
		t.Fatalf("roe = %v, want nil", *p.ROE)
	}
}

// D-22: the anchor-dated revenue wins over a `Revenues` fact at the prior-year date.
func TestOwnPeriod_RevenueAtAnchorBeatsPriorYearRevenues_feature340(t *testing.T) {
	p := opQ3(t, map[string][]map[string]any{
		"StockholdersEquity": {opInst("2026-09-30", 400)},
		"Revenues":           {opFlow("2025-07-01", "2025-09-30", 70)},
		"RevenueFromContractWithCustomerExcludingAssessedTax": {opFlow("2026-07-01", "2026-09-30", 90)},
	})
	if got := p.ExtraMetrics["revenue"]; got != 90 {
		t.Fatalf("revenue = %v, want the anchor-dated 90", got)
	}
}

// D-22: a later-dated Liabilities instant moves the anchor off the equity date.
func TestOwnPeriod_LaterLiabilitiesShiftsAnchor_feature340(t *testing.T) {
	p := opQ3(t, map[string][]map[string]any{
		"StockholdersEquity": {opInst("2026-09-30", 400)},
		"Liabilities":        {opInst("2026-10-31", 600)},
		"LongTermDebt":       {opInst("2026-09-30", 50)},
		"NetIncomeLoss":      {opFlow("2026-07-01", "2026-09-30", 10)},
	})
	if _, ok := p.ExtraMetrics["stockholders_equity"]; ok {
		t.Fatal("stockholders_equity present, want absent (anchor is 2026-10-31)")
	}
	if p.ROE != nil || p.DebtToEquity != nil {
		t.Fatalf("roe = %v, d/e = %v, want both nil", p.ROE, p.DebtToEquity)
	}
}

func TestOwnPeriod_BothRevenueTagsAtAnchor_RevenuesWins_feature340(t *testing.T) {
	for i := 0; i < 20; i++ {
		p := opQ3(t, map[string][]map[string]any{
			"StockholdersEquity": {opInst("2026-09-30", 400)},
			"RevenueFromContractWithCustomerExcludingAssessedTax": {opFlow("2026-07-01", "2026-09-30", 90)},
			"Revenues": {opFlow("2026-07-01", "2026-09-30", 95)},
		})
		if got := p.ExtraMetrics["revenue"]; got != 95 {
			t.Fatalf("run %d: revenue = %v, want Revenues 95", i, got)
		}
	}
}

// @AC-4: a loss year keeps its sign — net income and equity on one FY2025 date give a negative roe.
func TestOwnPeriod_AnnualNegativeROE_AC4_feature340(t *testing.T) {
	eq := map[string]any{"end": "2025-12-31", "val": 767000000, "accn": "y", "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2026-02-20"}
	ni := map[string]any{"start": "2025-01-01", "end": "2025-12-31", "val": -191750000, "accn": "y", "fy": 2025, "fp": "FY", "form": "10-K", "filed": "2026-02-20"}
	facts := map[string]any{
		"StockholdersEquity": map[string]any{"units": map[string]any{"USD": []map[string]any{eq}}},
		"NetIncomeLoss":      map[string]any{"units": map[string]any{"USD": []map[string]any{ni}}},
	}
	cf := map[string]any{"cik": 320193, "entityName": "T", "facts": map[string]any{"us-gaap": facts}}
	periods, err := newTestClientCF211(cf).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	p := periodByFP(t, periods, "FY2025")
	if p.ROE == nil {
		t.Fatal("FY2025 roe nil, want -0.25")
	}
	if math.Abs(*p.ROE-(-0.25)) > 1e-12 {
		t.Fatalf("FY2025 roe = %v, want -0.25", *p.ROE)
	}
}
