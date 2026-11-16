package edgar

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/xstockstrat/marketdata/internal/source"
	"github.com/xstockstrat/marketdata/internal/telemetry"
)

// --- feature 348: period identity from the filing's own period ---

// Real SEC companyfacts, trimmed by tag only: ORCL CIK0001341439, CRWD CIK0001535527, LYFT CIK0001759509.
func loadFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name + "_companyfacts.json")
	if err != nil {
		t.Fatal(err)
	}
	var cf map[string]any
	if err := json.Unmarshal(b, &cf); err != nil {
		t.Fatal(err)
	}
	return cf
}

// newTestClientCF211 resolves only the AAPL ticker; the payload is the named filer's.
func deriveFixture(t *testing.T, name string) Derivation {
	t.Helper()
	d, err := newTestClientCF211(loadFixture(t, name)).DeriveHistorical(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("DeriveHistorical(%s): %v", name, err)
	}
	return d
}

const (
	orclAccnQ1FY26 = "0001193125-25-200095" // 10-Q filed 2025-09-10, quarter ended 2025-08-31
	orclAccnQ1FY27 = "0001193125-26-389274" // 10-Q filed 2026-09-11, quarter ended 2026-08-31
)

func day(p time.Time) string { return p.Format(time.DateOnly) }

func periodEnding(t *testing.T, periods []source.HistoricalFundamentalsPeriod, ptype, end string) source.HistoricalFundamentalsPeriod {
	t.Helper()
	for _, p := range periods {
		if p.PeriodType == ptype && day(p.PeriodEnd) == end {
			return p
		}
	}
	t.Fatalf("no %s period with period_end %s", ptype, end)
	return source.HistoricalFundamentalsPeriod{}
}

// @AC-1: both 10-Qs carry fy 2026 / fp Q1; each quarter is its own period with its own values.
func TestORCL_SameFyFpTwoFilings_TwoPeriods_AC1_feature348(t *testing.T) {
	periods := deriveFixture(t, "orcl").Periods
	for _, w := range []struct {
		end, filed string
		ni, eq     float64
	}{
		{"2025-08-31", "2025-09-10", 2927000000, 24154000000},
		{"2026-08-31", "2026-09-11", 4760000000, 66772000000},
	} {
		p := periodEnding(t, periods, periodQuarterly, w.end)
		if day(p.FiledDate) != w.filed {
			t.Errorf("%s: filed_date = %s, want %s", w.end, day(p.FiledDate), w.filed)
		}
		if got := p.ExtraMetrics["net_income"]; got != w.ni {
			t.Errorf("%s: net_income = %v, want %v", w.end, got, w.ni)
		}
		if got := p.ExtraMetrics["stockholders_equity"]; got != w.eq {
			t.Errorf("%s: stockholders_equity = %v, want %v", w.end, got, w.eq)
		}
	}
}

// @AC-2: the cover-page share count (dated 2026-09-07) never dates the period.
func TestRealFilers_NoPeriodEndsAfterItWasFiled_AC2_feature348(t *testing.T) {
	orcl := deriveFixture(t, "orcl").Periods
	found := false
	for _, p := range orcl {
		if p.PeriodType == periodQuarterly && day(p.FiledDate) == "2026-09-11" {
			found = true
			if day(p.PeriodEnd) != "2026-08-31" {
				t.Errorf("period filed 2026-09-11 has period_end %s, want 2026-08-31", day(p.PeriodEnd))
			}
		}
	}
	if !found {
		t.Error("no quarterly period filed 2026-09-11")
	}
	for _, name := range []string{"orcl", "crwd", "lyft"} {
		for _, p := range deriveFixture(t, name).Periods {
			if p.PeriodEnd.After(p.FiledDate) {
				t.Errorf("%s %s %s: period_end %s after filed_date %s", name, p.FiscalPeriod, p.PeriodType, day(p.PeriodEnd), day(p.FiledDate))
			}
		}
	}
}

func identityList(periods []source.HistoricalFundamentalsPeriod) []string {
	out := make([]string, 0, len(periods))
	for _, p := range periods {
		out = append(out, fmt.Sprintf("%s|%s|%s|%s", p.FiscalPeriod, p.PeriodType, day(p.PeriodEnd), day(p.FiledDate)))
	}
	return out
}

// @AC-3: labels come from dates, are unique per type and do not depend on map order.
func TestRealFilers_LabelsUniqueAndDeterministic_AC3_feature348(t *testing.T) {
	orcl := deriveFixture(t, "orcl").Periods
	if got := periodEnding(t, orcl, periodQuarterly, "2025-08-31").FiscalPeriod; got != "Q1-2026" {
		t.Errorf("quarter ended 2025-08-31 labelled %q, want Q1-2026", got)
	}
	if got := periodEnding(t, orcl, periodQuarterly, "2026-08-31").FiscalPeriod; got != "Q1-2027" {
		t.Errorf("quarter ended 2026-08-31 labelled %q, want Q1-2027", got)
	}
	for _, name := range []string{"orcl", "crwd", "lyft"} {
		first := deriveFixture(t, name)
		seen := map[string]string{}
		for _, p := range first.Periods {
			key := p.PeriodType + "|" + p.FiscalPeriod
			if prev, dup := seen[key]; dup {
				t.Errorf("%s: label %s shared by periods ending %s and %s", name, key, prev, day(p.PeriodEnd))
			}
			seen[key] = day(p.PeriodEnd)
		}
		a, b := identityList(first.Periods), identityList(deriveFixture(t, name).Periods)
		if fmt.Sprint(a) != fmt.Sprint(b) {
			t.Errorf("%s: two derivations differ", name)
		}
	}
}

func newestQuarter(periods []source.HistoricalFundamentalsPeriod, filedBefore time.Time) (best source.HistoricalFundamentalsPeriod, ok bool) {
	for _, p := range periods {
		if p.PeriodType != periodQuarterly || (!filedBefore.IsZero() && !p.FiledDate.Before(filedBefore)) {
			continue
		}
		if !ok || p.PeriodEnd.After(best.PeriodEnd) {
			best, ok = p, true
		}
	}
	return best, ok
}

// @AC-4: what was public before 2025-10-01 is the quarter ended 2025-08-31, not the 2026 one.
func TestORCL_NewestQuarterFiledBeforeAsOf_AC4_feature348(t *testing.T) {
	asOf := time.Date(2025, 10, 1, 0, 0, 0, 0, time.UTC)
	p, ok := newestQuarter(deriveFixture(t, "orcl").Periods, asOf)
	if !ok || day(p.PeriodEnd) != "2025-08-31" || p.ExtraMetrics["stockholders_equity"] != 24154000000 {
		t.Fatalf("newest quarter filed before 2025-10-01 = %s equity %v, want 2025-08-31 with 24154000000", day(p.PeriodEnd), p.ExtraMetrics["stockholders_equity"])
	}
}

// @AC-6: the newest period is the quarter ended 2026-08-31 under its own filing date.
func TestORCL_NewestQuarterIsItsOwnFiling_AC6_feature348(t *testing.T) {
	p, ok := newestQuarter(deriveFixture(t, "orcl").Periods, time.Time{})
	if !ok || day(p.PeriodEnd) != "2026-08-31" || day(p.FiledDate) != "2026-09-11" || p.ExtraMetrics["stockholders_equity"] != 66772000000 {
		t.Fatalf("newest quarter = %s filed %s equity %v, want 2026-08-31 / 2026-09-11 / 66772000000", day(p.PeriodEnd), day(p.FiledDate), p.ExtraMetrics["stockholders_equity"])
	}
}

// The cover-page share count belongs to its filing and still feeds market cap.
func TestORCL_SharesFromOwnFilingCoverPage_feature348(t *testing.T) {
	cf := loadFixture(t, "orcl")
	units := cf["facts"].(map[string]any)["dei"].(map[string]any)["EntityCommonStockSharesOutstanding"].(map[string]any)["units"].(map[string]any)["shares"].([]any)
	want, found := 0.0, false
	for _, u := range units {
		d := u.(map[string]any)
		if d["accn"] == orclAccnQ1FY27 && d["end"] == "2026-09-07" {
			want, found = d["val"].(float64), true
		}
	}
	if !found {
		t.Fatal("fixture has no cover-page share fact dated 2026-09-07 for the 10-Q filed 2026-09-11")
	}
	p := periodEnding(t, deriveFixture(t, "orcl").Periods, periodQuarterly, "2026-08-31")
	if p.SharesOutstanding == nil || *p.SharesOutstanding != want {
		t.Fatalf("shares = %v, want the cover-page count %v", p.SharesOutstanding, want)
	}
}

// Labels are computed before the type and range filters.
func TestORCL_FiltersApplyAfterLabelling_feature348(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	periods, err := newTestClientCF211(loadFixture(t, "orcl")).FetchHistorical(context.Background(), "AAPL", from, time.Time{}, []string{"quarterly"})
	if err != nil {
		t.Fatal(err)
	}
	if got := periodEnding(t, periods, periodQuarterly, "2026-08-31").FiscalPeriod; got != "Q1-2027" {
		t.Fatalf("label = %q, want Q1-2027 with annual periods filtered out", got)
	}
	for _, p := range periods {
		if p.PeriodType != periodQuarterly || p.PeriodEnd.Before(from) {
			t.Fatalf("filter let through %s %s ending %s", p.FiscalPeriod, p.PeriodType, day(p.PeriodEnd))
		}
	}
}

// CRWD: two 10-Ks tagged fy 2022; a 10-K with no annual-length flow at its balance-sheet date.
func TestCRWD_AnnualPeriodsKeepTheirOwnIdentity_feature348(t *testing.T) {
	periods := deriveFixture(t, "crwd").Periods
	for _, w := range []struct{ end, filed, label string }{
		{"2022-01-31", "2022-03-16", "FY2022"},
		{"2023-01-31", "2023-03-09", "FY2023"},
	} {
		p := periodEnding(t, periods, periodAnnual, w.end)
		if day(p.FiledDate) != w.filed || p.FiscalPeriod != w.label {
			t.Errorf("annual %s: filed %s label %s, want %s %s", w.end, day(p.FiledDate), p.FiscalPeriod, w.filed, w.label)
		}
	}
	if p := periodEnding(t, periods, periodAnnual, "2021-01-31"); day(p.FiledDate) != "2021-03-18" {
		t.Errorf("annual 2021-01-31 filed %s, want 2021-03-18", day(p.FiledDate))
	}
}

// --- synthetic filings: one accession per filing ---

type synFact struct {
	taxonomy, tag, unit, start, end string
	val                             float64
}

type synFiling struct {
	accn, form, filed string
	facts             []synFact
}

func equityAt(end string, val float64) synFact {
	return synFact{taxonomy: "us-gaap", tag: "StockholdersEquity", unit: "USD", end: end, val: val}
}

func sharesAt(taxonomy, tag, end string, val float64) synFact {
	return synFact{taxonomy: taxonomy, tag: tag, unit: "shares", end: end, val: val}
}

func synCF(filings ...synFiling) map[string]any {
	facts := map[string]any{}
	for _, f := range filings {
		for _, sf := range f.facts {
			tax, _ := facts[sf.taxonomy].(map[string]any)
			if tax == nil {
				tax = map[string]any{}
				facts[sf.taxonomy] = tax
			}
			entry, _ := tax[sf.tag].(map[string]any)
			if entry == nil {
				entry = map[string]any{"units": map[string]any{}}
				tax[sf.tag] = entry
			}
			units := entry["units"].(map[string]any)
			d := map[string]any{"end": sf.end, "val": sf.val, "accn": f.accn, "form": f.form, "filed": f.filed}
			if sf.start != "" {
				d["start"] = sf.start
			}
			list, _ := units[sf.unit].([]map[string]any)
			units[sf.unit] = append(list, d)
		}
	}
	return map[string]any{"cik": 320193, "entityName": "Test Filer", "facts": facts}
}

func deriveSyn(t *testing.T, filings ...synFiling) Derivation {
	t.Helper()
	d, err := newTestClientCF211(synCF(filings...)).DeriveHistorical(context.Background(), "AAPL")
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestFormClass_DecidesPeriodType_feature348(t *testing.T) {
	want := map[string]string{
		"10-K": periodAnnual, "10-K/A": periodAnnual, "10-KT": periodAnnual, "10-KT/A": periodAnnual,
		"20-F": periodAnnual, "20-F/A": periodAnnual, "40-F": periodAnnual, "40-F/A": periodAnnual,
		"10-Q": periodQuarterly, "10-Q/A": periodQuarterly, "6-K": periodQuarterly, "6-K/A": periodQuarterly,
		"8-K": "", "S-1": "",
	}
	for form, class := range want {
		d := deriveSyn(t, synFiling{accn: "a1", form: form, filed: "2025-08-10", facts: []synFact{equityAt("2025-06-30", 100)}})
		switch {
		case class == "" && len(d.Periods) != 0:
			t.Errorf("%s: %d periods, want none", form, len(d.Periods))
		case class != "" && (len(d.Periods) != 1 || d.Periods[0].PeriodType != class):
			t.Errorf("%s: periods %v, want one %s", form, identityList(d.Periods), class)
		}
	}
}

func TestAccessionWithTwoForms_YieldsNoPeriod_feature348(t *testing.T) {
	cf := synCF(
		synFiling{accn: "a1", form: "10-Q", filed: "2025-08-10", facts: []synFact{equityAt("2025-06-30", 100)}},
		synFiling{accn: "a1", form: "10-K", filed: "2025-08-10", facts: []synFact{{taxonomy: "us-gaap", tag: "Assets", unit: "USD", end: "2025-06-30", val: 900}}},
	)
	d, err := newTestClientCF211(cf).DeriveHistorical(context.Background(), "AAPL")
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Periods) != 0 {
		t.Fatalf("periods = %v, want none for an accession whose facts disagree on form", identityList(d.Periods))
	}
}

func leftOutCounts(t *testing.T, reader *sdkmetric.ManualReader) map[string]int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	counts := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok || m.Name != "marketdata.backfill.periods_left_out" {
				continue
			}
			for _, dp := range sum.DataPoints {
				v, _ := dp.Attributes.Value(attribute.Key(telemetry.KeyReason))
				counts[v.AsString()] += dp.Value
			}
		}
	}
	return counts
}

// @AC-10: a year end moved later within one calendar year gives two annual periods and two
// quarters the same label; the later-ending one of each pair is left out and counted.
func TestYearEndMovedLater_LaterPeriodsLeftOut_AC10_feature348(t *testing.T) {
	cf := synCF(
		synFiling{accn: "q-mar", form: "10-Q", filed: "2023-05-05", facts: []synFact{equityAt("2023-03-31", 300)}},
		synFiling{accn: "k-jun", form: "10-K", filed: "2023-08-20", facts: []synFact{equityAt("2023-06-30", 310)}},
		synFiling{accn: "q-sep", form: "10-Q", filed: "2023-11-05", facts: []synFact{equityAt("2023-09-30", 320)}},
		synFiling{accn: "kt-dec", form: "10-KT", filed: "2024-02-20", facts: []synFact{equityAt("2023-12-31", 330)}},
	)
	reader := vendorMetricReader(t)
	c := newTestClientCF211(cf)
	d, err := c.DeriveHistorical(context.Background(), "AAPL")
	if err != nil {
		t.Fatal(err)
	}
	if n := leftOutCounts(t, reader)[telemetry.LeftOutLabelCollision]; n != 0 {
		t.Fatalf("DeriveHistorical counted %d left-out periods, want 0 (only the backfill path counts)", n)
	}
	if got := periodEnding(t, d.Periods, periodAnnual, "2023-06-30").FiscalPeriod; got != "FY2023" {
		t.Errorf("annual 2023-06-30 labelled %q, want FY2023", got)
	}
	if got := periodEnding(t, d.Periods, periodQuarterly, "2023-03-31").FiscalPeriod; got != "Q3-2023" {
		t.Errorf("quarter 2023-03-31 labelled %q, want Q3-2023", got)
	}
	if len(d.Periods) != 2 {
		t.Errorf("kept periods = %v, want two", identityList(d.Periods))
	}
	var left []string
	for _, lo := range d.LeftOut {
		left = append(left, lo.PeriodType+"|"+day(lo.PeriodEnd)+"|"+lo.Reason+"|"+lo.FiscalPeriod)
	}
	sort.Strings(left)
	wantLeft := []string{"annual|2023-12-31|label_collision|FY2023", "quarterly|2023-09-30|label_collision|Q3-2023"}
	if fmt.Sprint(left) != fmt.Sprint(wantLeft) {
		t.Errorf("left out = %v, want %v", left, wantLeft)
	}
	if _, err := c.FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil); err != nil {
		t.Fatal(err)
	}
	if n := leftOutCounts(t, reader)[telemetry.LeftOutLabelCollision]; n != 2 {
		t.Fatalf("periods_left_out{reason=label_collision} = %d after one FetchHistorical, want 2", n)
	}
}

// A December → November year-end change filed on a 10-KT: the transition filing's end is a
// fiscal-year boundary, so the three quarters before it keep their own numbers.
func TestYearEndMovedEarlier_TransitionFilingIsABoundary_feature348(t *testing.T) {
	q := func(accn, end, filed string) synFiling {
		return synFiling{accn: accn, form: "10-Q", filed: filed, facts: []synFact{equityAt(end, 100)}}
	}
	d := deriveSyn(t,
		synFiling{accn: "k17", form: "10-K", filed: "2018-02-27", facts: []synFact{equityAt("2017-12-31", 100)}},
		q("q1", "2018-03-31", "2018-05-02"), q("q2", "2018-06-30", "2018-08-01"), q("q3", "2018-09-30", "2018-11-01"),
		synFiling{accn: "kt18", form: "10-KT", filed: "2019-01-29", facts: []synFact{equityAt("2018-11-30", 100)}},
		q("q4", "2019-02-28", "2019-04-09"),
		synFiling{accn: "k19", form: "10-K", filed: "2020-01-29", facts: []synFact{equityAt("2019-11-30", 100)}},
	)
	for end, want := range map[string]string{"2018-03-31": "Q1-2018", "2018-06-30": "Q2-2018", "2018-09-30": "Q3-2018", "2019-02-28": "Q1-2019"} {
		if got := periodEnding(t, d.Periods, periodQuarterly, end).FiscalPeriod; got != want {
			t.Errorf("quarter %s labelled %q, want %s", end, got, want)
		}
	}
	if len(d.LeftOut) != 0 {
		t.Errorf("left out = %+v, want none", d.LeftOut)
	}
}

func TestQuarterLabel_FloorArithmetic_feature348(t *testing.T) {
	d := func(s string) time.Time { v, _ := time.Parse(time.DateOnly, s); return v }
	bounds := []time.Time{d("2020-09-26")}
	for end, want := range map[string]string{
		"2019-12-28": "Q1-2020", // closed by the boundary, three quarters ahead
		"2020-12-26": "Q1-2021", // projected one quarter past the nearest boundary
		"2021-03-27": "Q2-2021",
		"2021-12-25": "Q1-2022", // five quarters past: floor, not truncation
	} {
		if got, atBoundary := quarterLabel(d(end), bounds); got != want || atBoundary {
			t.Errorf("quarterLabel(%s) = %q atBoundary=%v, want %s", end, got, atBoundary, want)
		}
	}
	if got, atBoundary := quarterLabel(d("2019-12-28"), nil); got != "Q4-2019" || atBoundary {
		t.Errorf("no boundary: %q atBoundary=%v, want Q4-2019 kept", got, atBoundary)
	}
}

func TestQuarterlyFilingAtFiscalYearEnd_LeftOut_feature348(t *testing.T) {
	d := deriveSyn(t,
		synFiling{accn: "k", form: "40-F", filed: "2025-02-20", facts: []synFact{equityAt("2024-12-31", 500)}},
		synFiling{accn: "q", form: "6-K", filed: "2025-02-10", facts: []synFact{equityAt("2024-12-31", 500)}},
	)
	if len(d.Periods) != 1 || d.Periods[0].PeriodType != periodAnnual {
		t.Fatalf("periods = %v, want the annual period only", identityList(d.Periods))
	}
	if len(d.LeftOut) != 1 || d.LeftOut[0].Reason != telemetry.LeftOutYearEndQuarter || d.LeftOut[0].PeriodType != periodQuarterly {
		t.Fatalf("left out = %+v, want one quarterly year_end_quarter", d.LeftOut)
	}
	lone := deriveSyn(t, synFiling{accn: "q", form: "10-Q", filed: "2025-02-10", facts: []synFact{equityAt("2024-12-31", 500)}})
	if len(lone.Periods) != 1 || lone.Periods[0].FiscalPeriod != "Q4-2024" || len(lone.LeftOut) != 0 {
		t.Fatalf("lone quarter: periods %v left out %+v, want one kept Q4-2024", identityList(lone.Periods), lone.LeftOut)
	}
}

func TestShares_LatestOnOrBeforeFiled_TieRules_feature348(t *testing.T) {
	const gaap, dei = "us-gaap", "dei"
	shares := func(facts ...synFact) *float64 {
		t.Helper()
		all := append([]synFact{equityAt("2026-03-31", 100)}, facts...)
		d := deriveSyn(t, synFiling{accn: "q", form: "10-Q", filed: "2026-05-01", facts: all})
		if len(d.Periods) != 1 || day(d.Periods[0].PeriodEnd) != "2026-03-31" {
			t.Fatalf("periods = %v, want one ending 2026-03-31 (a share fact never dates a period)", identityList(d.Periods))
		}
		return d.Periods[0].SharesOutstanding
	}
	for name, tc := range map[string]struct {
		facts []synFact
		want  float64
	}{
		"latest date wins": {[]synFact{
			sharesAt(gaap, "CommonStockSharesOutstanding", "2026-03-31", 80),
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-04-20", 90),
		}, 90},
		"dei wins on equal dates": {[]synFact{
			sharesAt(gaap, "CommonStockSharesOutstanding", "2026-04-20", 100),
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-04-20", 90),
		}, 90},
		"larger value wins within one tag and date": {[]synFact{
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-04-20", 90),
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-04-20", 95),
		}, 95},
		"a share fact dated after filed is not used": {[]synFact{
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-04-20", 90),
			sharesAt(dei, "EntityCommonStockSharesOutstanding", "2026-05-10", 999),
		}, 90},
	} {
		for i := 0; i < 10; i++ { // map order must not decide
			if got := shares(tc.facts...); got == nil || *got != tc.want {
				t.Fatalf("%s: shares = %v, want %v", name, got, tc.want)
			}
		}
	}
}
