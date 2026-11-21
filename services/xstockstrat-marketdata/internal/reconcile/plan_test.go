package reconcile

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

func d(s string) time.Time {
	v, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return v
}

const (
	quarterly = "quarterly"
	annual    = "annual"
)

func stored(label, ptype, end, filed string, version int, extra map[string]float64) source.HistoricalPriceState {
	return source.HistoricalPriceState{FiscalPeriod: label, PeriodType: ptype, PeriodEnd: d(end), FiledDate: d(filed), DerivationVersion: version, ExtraMetrics: extra}
}

func fresh(label, ptype, end, filed string, extra map[string]float64) source.HistoricalFundamentalsPeriod {
	return source.HistoricalFundamentalsPeriod{FiscalPeriod: label, PeriodType: ptype, PeriodEnd: d(end), FiledDate: d(filed), DerivationVersion: 3, ExtraMetrics: extra}
}

// same is a reported value both sides share, so the filer guard passes.
var same = map[string]float64{"assets": 500}

func keys(rows []source.HistoricalPriceState) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r.FiscalPeriod+"|"+r.PeriodType)
	}
	return out
}

func ends(ps []source.HistoricalFundamentalsPeriod) []string {
	out := []string{}
	for _, p := range ps {
		out = append(out, p.FiscalPeriod+"@"+p.PeriodEnd.Format(time.DateOnly))
	}
	return out
}

func mustBuild(t *testing.T, s []source.HistoricalPriceState, f []source.HistoricalFundamentalsPeriod, req Request) Plan {
	t.Helper()
	p, err := Build(s, f, req)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	return p
}

func expect(t *testing.T, what string, got, want []string) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s = %v, want %v", what, got, want)
	}
}

// D-13: identity is (label, type, period_end, filed_date); any difference replaces the row.
func TestBuild_Identity(t *testing.T) {
	f := []source.HistoricalFundamentalsPeriod{fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", same)}
	for name, tc := range map[string]struct {
		row              source.HistoricalPriceState
		identical, moved int
	}{
		"all four equal":       {stored("Q1-2026", quarterly, "2025-08-31", "2025-09-10", 3, same), 1, 0},
		"label differs":        {stored("Q1-2025", quarterly, "2025-08-31", "2025-09-10", 3, same), 0, 1},
		"period_end differs":   {stored("Q1-2026", quarterly, "2025-09-05", "2025-09-10", 3, same), 0, 1},
		"filed_date differs":   {stored("Q1-2026", quarterly, "2025-08-31", "2025-09-12", 3, same), 0, 1},
		"same day, other hour": {source.HistoricalPriceState{FiscalPeriod: "Q1-2026", PeriodType: quarterly, PeriodEnd: d("2025-08-31").Add(5 * time.Hour), FiledDate: d("2025-09-10"), DerivationVersion: 3, ExtraMetrics: same}, 1, 0},
	} {
		p := mustBuild(t, []source.HistoricalPriceState{tc.row}, f, Request{})
		if len(p.Identical) != tc.identical || len(p.Deletes) != tc.moved || len(p.Inserts) != tc.moved {
			t.Errorf("%s: identical %d deletes %d inserts %d, want %d/%d/%d", name, len(p.Identical), len(p.Deletes), len(p.Inserts), tc.identical, tc.moved, tc.moved)
		}
	}
}

// @AC-8, first half: the range ends before the later collided period; rule (c) still restores it.
func TestBuild_CollidedRowRestoresBothPeriods_AC8_feature348(t *testing.T) {
	s := []source.HistoricalPriceState{stored("Q1-2026", quarterly, "2026-09-07", "2025-09-10", 2, map[string]float64{"net_income": 4760000000, "stockholders_equity": 66772000000})}
	f := []source.HistoricalFundamentalsPeriod{
		fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", map[string]float64{"net_income": 2927000000, "stockholders_equity": 24154000000}),
		fresh("Q1-2027", quarterly, "2026-08-31", "2026-09-11", map[string]float64{"net_income": 4760000000, "stockholders_equity": 66772000000}),
	}
	p := mustBuild(t, s, f, Request{From: d("2016-01-01"), To: d("2026-06-30")})
	expect(t, "deletes", keys(p.Deletes), []string{"Q1-2026|quarterly"})
	expect(t, "inserts", ends(p.Inserts), []string{"Q1-2026@2025-08-31", "Q1-2027@2026-08-31"})
	if len(p.Unreplaced) != 0 {
		t.Errorf("unreplaced = %+v, want none (the collided row's period is stored again)", p.Unreplaced)
	}
}

// @AC-8, second half: a repaired symbol's ranged backfill touches nothing outside its range.
func TestBuild_RepairedSymbolRangeLimitsInserts_AC8_feature348(t *testing.T) {
	s := []source.HistoricalPriceState{
		stored("Q3-2025", quarterly, "2025-02-28", "2025-03-11", 3, same),
		stored("Q1-2026", quarterly, "2025-08-31", "2025-09-10", 3, same),
	}
	f := []source.HistoricalFundamentalsPeriod{
		fresh("Q1-2015", quarterly, "2014-08-31", "2014-09-18", same), // older than anything stored
		fresh("Q3-2025", quarterly, "2025-02-28", "2025-03-11", same),
		fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", same),
		fresh("Q1-2027", quarterly, "2026-08-31", "2026-09-11", same), // after the range
	}
	p := mustBuild(t, s, f, Request{From: d("2026-01-01"), To: d("2026-06-30")})
	if len(p.Deletes) != 0 || len(p.Inserts) != 0 || len(p.Identical) != 0 {
		t.Fatalf("deletes %v inserts %v identical %d, want nothing planned", keys(p.Deletes), ends(p.Inserts), len(p.Identical))
	}
	open := mustBuild(t, s, f, Request{})
	if len(open.Identical) != 2 || len(open.Inserts) != 2 {
		t.Fatalf("open range: identical %d inserts %v, want 2 identical and both missing periods", len(open.Identical), ends(open.Inserts))
	}
}

// Rule (b) and O-4: a current-version row the derivation no longer reproduces is replaced by the
// period at its (type, period_end) even outside the range; rule (c) does not open the range.
func TestBuild_CurrentVersionOrphanReplacedAtItsPeriodEnd(t *testing.T) {
	s := []source.HistoricalPriceState{
		stored("Q4-2019", quarterly, "2019-12-28", "2020-01-29", 3, same), // relabelled once the 10-K arrived
		stored("Q1-2026", quarterly, "2025-08-31", "2025-09-10", 3, same),
	}
	f := []source.HistoricalFundamentalsPeriod{
		fresh("Q3-2019", quarterly, "2019-06-29", "2019-07-31", same), // out of range, unrelated
		fresh("Q1-2020", quarterly, "2019-12-28", "2020-01-29", same),
		fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", same),
	}
	p := mustBuild(t, s, f, Request{From: d("2025-01-01")})
	expect(t, "deletes", keys(p.Deletes), []string{"Q4-2019|quarterly"})
	expect(t, "inserts", ends(p.Inserts), []string{"Q1-2020@2019-12-28"})
}

// A label chain: each stored label holds the year the fresh set gives the next label.
func TestBuild_LabelChainDeletesAndInsertsSameKeys(t *testing.T) {
	s := []source.HistoricalPriceState{
		stored("FY2023", annual, "2024-01-31", "2024-03-07", 2, same),
		stored("FY2022", annual, "2023-01-31", "2023-03-09", 2, same),
		stored("FY2024", annual, "2025-01-31", "2025-03-10", 2, same),
	}
	f := []source.HistoricalFundamentalsPeriod{
		fresh("FY2023", annual, "2023-01-31", "2023-03-09", same),
		fresh("FY2024", annual, "2024-01-31", "2024-03-07", same),
		fresh("FY2025", annual, "2025-01-31", "2025-03-10", same),
	}
	p := mustBuild(t, s, f, Request{})
	expect(t, "deletes (sorted by key)", keys(p.Deletes), []string{"FY2022|annual", "FY2023|annual", "FY2024|annual"})
	expect(t, "inserts", ends(p.Inserts), []string{"FY2023@2023-01-31", "FY2024@2024-01-31", "FY2025@2025-01-31"})
	if len(p.Unreplaced) != 0 {
		t.Errorf("unreplaced = %+v, want none", p.Unreplaced)
	}
}

func TestBuild_UnrequestedTypeIsNeverTouched(t *testing.T) {
	s := []source.HistoricalPriceState{
		stored("Q1-2026", quarterly, "2026-09-07", "2025-09-10", 2, same),
		stored("FY2025", annual, "2025-06-05", "2025-06-18", 2, same),
	}
	f := []source.HistoricalFundamentalsPeriod{
		fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", same),
		fresh("FY2025", annual, "2025-05-31", "2025-06-18", same),
	}
	p := mustBuild(t, s, f, Request{PeriodTypes: []string{annual}})
	expect(t, "deletes", keys(p.Deletes), []string{"FY2025|annual"})
	expect(t, "inserts", ends(p.Inserts), []string{"FY2025@2025-05-31"})
}

// @AC-9 and the other guards.
func TestBuild_Guards_AC9_feature348(t *testing.T) {
	orcl := map[string]float64{"net_income": 2927000000, "stockholders_equity": 24154000000}
	other := map[string]float64{"net_income": 100000000, "stockholders_equity": 900000000}
	row := func(extra map[string]float64) []source.HistoricalPriceState {
		return []source.HistoricalPriceState{stored("Q1-2026", quarterly, "2025-08-31", "2025-09-10", 2, extra)}
	}
	q := func(extra map[string]float64) []source.HistoricalFundamentalsPeriod {
		return []source.HistoricalFundamentalsPeriod{fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", extra)}
	}
	for name, tc := range map[string]struct {
		s    []source.HistoricalPriceState
		f    []source.HistoricalFundamentalsPeriod
		req  Request
		want error
	}{
		"another filer's values":            {row(orcl), q(other), Request{}, ErrFilerMismatch},
		"stored rows hold none of the five": {row(map[string]float64{"total_debt": 5}), q(orcl), Request{}, ErrFilerMismatch},
		"a stored zero is not a match":      {row(map[string]float64{"revenue": 0}), q(map[string]float64{"revenue": 0}), Request{}, ErrFilerMismatch},
		"fresh set empty":                   {row(orcl), nil, Request{}, ErrFreshEmpty},
		"requested type absent from fresh":  {row(orcl), []source.HistoricalFundamentalsPeriod{fresh("FY2025", annual, "2025-05-31", "2025-06-18", orcl)}, Request{}, ErrTypeMissing},
		"same filer":                        {row(orcl), q(orcl), Request{}, nil},
		"match on another period type":      {row(orcl), append(q(other), fresh("FY2025", annual, "2025-05-31", "2025-06-18", orcl)), Request{}, nil},
		"no stored row skips every guard":   {nil, nil, Request{}, nil},
	} {
		p, err := Build(tc.s, tc.f, tc.req)
		if !errors.Is(err, tc.want) || (tc.want == nil && err != nil) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
		if tc.want != nil && (len(p.Deletes) != 0 || len(p.Inserts) != 0 || len(p.Identical) != 0) {
			t.Errorf("%s: a guard error must carry an empty plan, got %+v", name, p)
		}
	}
}

// S-3, S-4: only a row whose period no longer exists in the table is listed, with its category.
func TestBuild_DeletedWithoutReplacement_Categories(t *testing.T) {
	cat := func(p Plan) []string {
		out := []string{}
		for _, u := range p.Unreplaced {
			out = append(out, u.Row.FiscalPeriod+"|"+u.Row.PeriodType+"="+u.Category)
		}
		return out
	}
	base := fresh("Q1-2026", quarterly, "2025-08-31", "2025-09-10", same)
	baseRow := stored("Q1-2026", quarterly, "2025-08-31", "2025-09-10", 3, same)

	// A cover-page period_end corrected to the balance-sheet date: replaced, not listed.
	p := mustBuild(t, []source.HistoricalPriceState{stored("Q1-2026", quarterly, "2025-09-05", "2025-09-10", 2, same)}, []source.HistoricalFundamentalsPeriod{base}, Request{})
	expect(t, "cover-page correction", cat(p), nil)

	// Two stored rows filed the same day, one fresh period: one replaced, one merged.
	p = mustBuild(t, []source.HistoricalPriceState{
		stored("Q1-2026", quarterly, "2025-09-05", "2025-09-10", 2, same),
		stored("Q4-2025", quarterly, "2025-09-06", "2025-09-10", 2, same),
	}, []source.HistoricalFundamentalsPeriod{base}, Request{})
	expect(t, "merged", cat(p), []string{"Q4-2025|quarterly=" + CategoryMerged})

	// An "annual" row that was a 10-Q: its filing now yields a quarterly period.
	p = mustBuild(t, []source.HistoricalPriceState{baseRow, stored("FY2015", annual, "2014-12-31", "2015-02-09", 2, same)},
		[]source.HistoricalFundamentalsPeriod{base, fresh("FY2025", annual, "2025-05-31", "2025-06-18", same), fresh("Q2-2015", quarterly, "2014-12-31", "2015-02-09", same)}, Request{})
	expect(t, "period type changed", cat(p), []string{"FY2015|annual=" + CategoryPeriodTypeChanged})

	// A row from a form that no longer yields a period.
	orphan := stored("Q2-2019", quarterly, "2019-03-31", "2019-05-20", 2, same)
	p = mustBuild(t, []source.HistoricalPriceState{baseRow, orphan}, []source.HistoricalFundamentalsPeriod{base}, Request{})
	expect(t, "no period derived", cat(p), []string{"Q2-2019|quarterly=" + CategoryNoPeriodDerived})

	// The same row when the derivation reports its period as left out.
	p = mustBuild(t, []source.HistoricalPriceState{baseRow, orphan}, []source.HistoricalFundamentalsPeriod{base},
		Request{LeftOut: []source.LeftOutPeriod{{FiscalPeriod: "Q3-2019", PeriodType: quarterly, PeriodEnd: d("2019-03-31"), FiledDate: d("2019-05-20"), Reason: "label_collision"}}})
	expect(t, "left out", cat(p), []string{"Q2-2019|quarterly=" + CategoryLeftOut})
}
