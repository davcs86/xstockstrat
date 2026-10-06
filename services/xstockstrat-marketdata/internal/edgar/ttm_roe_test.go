package edgar

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// AXP-shaped fixture (feature 222). Q4-2025 has no standalone fact (10-K only) and must be derived
// as FY − Q1..Q3. The Q2-2026 10-Q also carries the prior-year Q2 comparative under the SAME fy/fp,
// listed first — the TTM must key on each fact's own period, not the filing's fy/fp.
func axpFacts() map[string]any {
	ni := func(fy int, fp, start, end, filed string, val float64) map[string]any {
		return map[string]any{"start": start, "end": end, "val": val, "accn": "x", "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}
	}
	eq := func(fy int, fp, end, filed string, val float64) map[string]any {
		return map[string]any{"end": end, "val": val, "accn": "x", "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}
	}
	niUnits := []map[string]any{
		ni(2025, "Q1", "2025-01-01", "2025-03-31", "2025-04-25", 1000e6),
		ni(2025, "Q2", "2025-04-01", "2025-06-30", "2025-07-25", 1100e6),
		ni(2025, "Q3", "2025-07-01", "2025-09-30", "2025-10-24", 2500e6),
		ni(2025, "FY", "2025-01-01", "2025-12-31", "2026-02-10", 7200e6), // ⇒ Q4-2025 = 2,600M
		ni(2026, "Q1", "2026-01-01", "2026-03-31", "2026-04-24", 2700e6),
		ni(2026, "Q2", "2025-04-01", "2025-06-30", "2026-07-24", 1100e6), // comparative column
		ni(2026, "Q2", "2026-04-01", "2026-06-30", "2026-07-24", 2885e6),
	}
	eqUnits := []map[string]any{
		eq(2025, "FY", "2025-12-31", "2026-02-10", 30000e6),
		eq(2026, "Q2", "2026-06-30", "2026-07-24", 30264e6),
	}
	return map[string]any{"cik": 4962, "entityName": "AXP", "facts": map[string]any{"us-gaap": map[string]any{
		"NetIncomeLoss":      map[string]any{"units": map[string]any{"USD": niUnits}},
		"StockholdersEquity": map[string]any{"units": map[string]any{"USD": eqUnits}},
	}}}
}

func periodByFP(t *testing.T, periods []source.HistoricalFundamentalsPeriod, fp string) source.HistoricalFundamentalsPeriod {
	t.Helper()
	for _, p := range periods {
		if p.FiscalPeriod == fp {
			return p
		}
	}
	t.Fatalf("period %s not found", fp)
	return source.HistoricalFundamentalsPeriod{}
}

func fetchAXP(t *testing.T) []source.HistoricalFundamentalsPeriod {
	t.Helper()
	periods, err := newTestClientCF211(axpFacts()).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatalf("FetchHistorical: %v", err)
	}
	return periods
}

// @AC-1: Q2-2026 roe = (2,500 + 2,600 + 2,700 + 2,885) / 30,264 ≈ 0.353, not 2,885 / 30,264 ≈ 0.095.
func TestQuarterlyROE_TrailingTwelveMonths_AC1(t *testing.T) {
	p := periodByFP(t, fetchAXP(t), "Q2-2026")
	if p.ROE == nil {
		t.Fatal("roe nil")
	}
	want := 10685.0 / 30264.0
	if math.Abs(*p.ROE-want) > 1e-9 {
		t.Fatalf("roe = %.6f, want %.6f (TTM)", *p.ROE, want)
	}
}

// @AC-3: annual periods keep annual net income / year-end equity.
func TestAnnualROE_Unchanged_AC3(t *testing.T) {
	p := periodByFP(t, fetchAXP(t), "FY2025")
	if p.ROE == nil || math.Abs(*p.ROE-7200.0/30000.0) > 1e-9 {
		t.Fatalf("FY2025 roe = %v, want 0.24", p.ROE)
	}
}

func TestTrailingNetIncome_AnnualizesWhenFewerThanFourQuarters(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }
	facts := []niFact{
		{start: d("2026-01-01"), end: d("2026-03-31"), filed: d("2026-04-24"), unit: "USD", val: 100},
		{start: d("2026-04-01"), end: d("2026-06-30"), filed: d("2026-07-24"), unit: "USD", val: 120},
	}
	sum, n := trailingNetIncome(facts, "USD", d("2026-06-30"), d("2026-07-24"))
	if sum != 220 || n != 2 {
		t.Fatalf("sum=%v n=%d, want 220/2 (annualized ×4/2 by the caller)", sum, n)
	}
}

// PIT: a quarter first filed AFTER the period's own filing must not enter its TTM.
func TestTrailingNetIncome_ExcludesLaterFilings(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse("2006-01-02", s); return v }
	facts := []niFact{
		{start: d("2026-01-01"), end: d("2026-03-31"), filed: d("2026-08-30"), unit: "USD", val: 999},
		{start: d("2026-04-01"), end: d("2026-06-30"), filed: d("2026-07-24"), unit: "USD", val: 120},
		{start: d("2026-04-01"), end: d("2026-06-30"), filed: d("2026-07-24"), unit: "CNY", val: 5},
	}
	sum, n := trailingNetIncome(facts, "USD", d("2026-06-30"), d("2026-07-24"))
	if sum != 120 || n != 1 {
		t.Fatalf("sum=%v n=%d, want 120/1", sum, n)
	}
}

func TestQuarterlyROE_SingleQuarterAnnualizedFallback(t *testing.T) {
	cf := axpFacts()
	units := cf["facts"].(map[string]any)["us-gaap"].(map[string]any)["NetIncomeLoss"].(map[string]any)["units"].(map[string]any)
	units["USD"] = units["USD"].([]map[string]any)[6:] // only the Q2-2026 fact
	periods, err := newTestClientCF211(cf).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, []string{"quarterly"})
	if err != nil {
		t.Fatal(err)
	}
	p := periodByFP(t, periods, "Q2-2026")
	if p.ROE == nil || math.Abs(*p.ROE-2885.0*4/30264.0) > 1e-9 {
		t.Fatalf("roe = %v, want single quarter ×4", p.ROE)
	}
}
