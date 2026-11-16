// Package fundaudit reports what a fundamentals backfill would change for a lane's stored rows, and
// what a finished repair changed. It writes nothing: the stored rows come from a file and the
// derivation from an interface.
package fundaudit

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"sort"
	"time"

	"github.com/xstockstrat/marketdata/internal/edgar"
	"github.com/xstockstrat/marketdata/internal/reconcile"
	"github.com/xstockstrat/marketdata/internal/source"
)

// Deriver is the SEC-backed derivation; *edgar.Client satisfies it.
type Deriver interface {
	DeriveHistorical(ctx context.Context, symbol string) (edgar.Derivation, error)
}

// Price-join columns, named as HistoricalFundamentalsPeriod.missing_metrics names them.
const (
	colPrice         = "price"
	colMarketCap     = "market_cap"
	colPERatio       = "pe_ratio"
	colPBRatio       = "pb_ratio"
	colDividendYield = "dividend_yield"
)

// period is one stored row as query_fundamentals (historical mode) serialises it.
type period struct {
	FiscalPeriod   string             `json:"fiscal_period"`
	PeriodType     string             `json:"period_type"`
	PeriodEnd      string             `json:"period_end"`
	FiledDate      string             `json:"filed_date"`
	MarketCap      float64            `json:"market_cap"`
	PERatio        float64            `json:"pe_ratio"`
	PBRatio        float64            `json:"pb_ratio"`
	DividendYield  float64            `json:"dividend_yield"`
	Price          float64            `json:"price"`
	ExtraMetrics   map[string]float64 `json:"extra_metrics"`
	Currency       string             `json:"currency"`
	MissingMetrics []string           `json:"missing_metrics"`
}

// ParseRows reads a lane rows file, {"<SYMBOL>": [period, ...]}. The serialised row carries no
// derivation version, so every row gets storedVersion; a column named in missing_metrics is nil.
func ParseRows(r io.Reader, storedVersion int) (map[string][]source.HistoricalPriceState, error) {
	var doc map[string][]period
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return nil, fmt.Errorf("rows file: %w", err)
	}
	out := make(map[string][]source.HistoricalPriceState, len(doc))
	for symbol, periods := range doc {
		rows := make([]source.HistoricalPriceState, 0, len(periods))
		for _, p := range periods {
			end, err := time.Parse(time.RFC3339, p.PeriodEnd)
			if err != nil {
				return nil, fmt.Errorf("rows file: %s %s %s: period_end: %w", symbol, p.FiscalPeriod, p.PeriodType, err)
			}
			filed, err := time.Parse(time.RFC3339, p.FiledDate)
			if err != nil {
				return nil, fmt.Errorf("rows file: %s %s %s: filed_date: %w", symbol, p.FiscalPeriod, p.PeriodType, err)
			}
			value := func(column string, v float64) *float64 {
				if slices.Contains(p.MissingMetrics, column) {
					return nil
				}
				return &v
			}
			rows = append(rows, source.HistoricalPriceState{
				FiscalPeriod: p.FiscalPeriod, PeriodType: p.PeriodType, PeriodEnd: end, FiledDate: filed,
				Price: value(colPrice, p.Price), MarketCap: value(colMarketCap, p.MarketCap), PERatio: value(colPERatio, p.PERatio),
				PBRatio: value(colPBRatio, p.PBRatio), DividendYield: value(colDividendYield, p.DividendYield),
				Currency: p.Currency, DerivationVersion: storedVersion, ExtraMetrics: p.ExtraMetrics,
			})
		}
		out[symbol] = rows
	}
	return out, nil
}

// DeletedRow is a stored row the plan deletes and no derived period replaces.
type DeletedRow struct {
	FiscalPeriod string `json:"fiscal_period"`
	PeriodType   string `json:"period_type"`
	PeriodEnd    string `json:"period_end"`
	FiledDate    string `json:"filed_date"`
	Category     string `json:"category"`
}

// LeftOutPeriod is a derived period the derivation leaves out of its result.
type LeftOutPeriod struct {
	FiscalPeriod string `json:"fiscal_period"`
	PeriodType   string `json:"period_type"`
	PeriodEnd    string `json:"period_end"`
	FiledDate    string `json:"filed_date"`
	Reason       string `json:"reason"`
}

// SymbolReport is what a full-history backfill of one symbol would do.
type SymbolReport struct {
	Symbol                    string          `json:"symbol"`
	DeriveError               string          `json:"derive_error,omitempty"`
	Guard                     string          `json:"guard,omitempty"`
	Stored                    int             `json:"stored"`
	Derived                   int             `json:"derived"`
	Identical                 int             `json:"identical"`
	Deletes                   int             `json:"deletes"`
	Inserts                   int             `json:"inserts"`
	DeletedWithoutReplacement []DeletedRow    `json:"deleted_without_replacement"`
	LeftOut                   []LeftOutPeriod `json:"left_out"`
	SingleMetricAnchors       int             `json:"single_metric_anchors"`
	DerivedEndAfterFiled      int             `json:"derived_period_end_after_filed_date"`
}

// Totals are counted over the stored rows alone.
type Totals struct {
	Rows                int `json:"rows"`
	EndAfterFiled       int `json:"period_end_after_filed_date"`
	DuplicatePeriodEnds int `json:"duplicate_period_end_groups"`
}

// Verdict is the post-repair pass condition.
type Verdict struct {
	Pass    bool     `json:"pass"`
	Reasons []string `json:"reasons"`
}

// Report is one lane's audit.
type Report struct {
	StoredVersion                       int            `json:"stored_version"`
	Totals                              Totals         `json:"totals"`
	DeletedWithoutReplacementByCategory map[string]int `json:"deleted_without_replacement_by_category"`
	LeftOutByReason                     map[string]int `json:"left_out_by_reason"`
	Symbols                             []SymbolReport `json:"symbols"`
	PostRepair                          *Verdict       `json:"post_repair,omitempty"`
}

func day(t time.Time) string { return t.Format(time.DateOnly) }

// Plan audits every symbol of rows, in symbol order. A symbol that cannot be derived is reported
// and the lane continues.
func Plan(ctx context.Context, d Deriver, rows map[string][]source.HistoricalPriceState, storedVersion int) Report {
	report := Report{
		StoredVersion: storedVersion, Totals: laneTotals(rows),
		DeletedWithoutReplacementByCategory: map[string]int{}, LeftOutByReason: map[string]int{},
	}
	symbols := make([]string, 0, len(rows))
	for symbol := range rows {
		symbols = append(symbols, symbol)
	}
	sort.Strings(symbols)
	for _, symbol := range symbols {
		sr := planSymbol(ctx, d, symbol, rows[symbol])
		for _, row := range sr.DeletedWithoutReplacement {
			report.DeletedWithoutReplacementByCategory[row.Category]++
		}
		for _, lo := range sr.LeftOut {
			report.LeftOutByReason[lo.Reason]++
		}
		report.Symbols = append(report.Symbols, sr)
	}
	return report
}

func planSymbol(ctx context.Context, d Deriver, symbol string, stored []source.HistoricalPriceState) SymbolReport {
	sr := SymbolReport{Symbol: symbol, Stored: len(stored), DeletedWithoutReplacement: []DeletedRow{}, LeftOut: []LeftOutPeriod{}}
	derivation, err := d.DeriveHistorical(ctx, symbol)
	if err != nil {
		sr.DeriveError = err.Error()
		return sr
	}
	sr.Derived, sr.SingleMetricAnchors = len(derivation.Periods), derivation.SingleMetricAnchors
	for _, p := range derivation.Periods {
		if day(p.PeriodEnd) > day(p.FiledDate) {
			sr.DerivedEndAfterFiled++
		}
	}
	for _, lo := range derivation.LeftOut {
		sr.LeftOut = append(sr.LeftOut, LeftOutPeriod{
			FiscalPeriod: lo.FiscalPeriod, PeriodType: lo.PeriodType, PeriodEnd: day(lo.PeriodEnd), FiledDate: day(lo.FiledDate), Reason: lo.Reason,
		})
	}
	plan, err := reconcile.Build(stored, derivation.Periods, reconcile.Request{LeftOut: derivation.LeftOut})
	if err != nil {
		sr.Guard = err.Error()
		return sr
	}
	sr.Identical, sr.Deletes, sr.Inserts = len(plan.Identical), len(plan.Deletes), len(plan.Inserts)
	for _, u := range plan.Unreplaced {
		sr.DeletedWithoutReplacement = append(sr.DeletedWithoutReplacement, DeletedRow{
			FiscalPeriod: u.Row.FiscalPeriod, PeriodType: u.Row.PeriodType, PeriodEnd: day(u.Row.PeriodEnd), FiledDate: day(u.Row.FiledDate), Category: u.Category,
		})
	}
	return sr
}

func laneTotals(rows map[string][]source.HistoricalPriceState) Totals {
	type group struct{ symbol, periodType, end string }
	var t Totals
	groups := map[group]int{}
	for symbol, stored := range rows {
		for _, row := range stored {
			t.Rows++
			if day(row.PeriodEnd) > day(row.FiledDate) {
				t.EndAfterFiled++
			}
			groups[group{symbol, row.PeriodType, day(row.PeriodEnd)}]++
		}
	}
	for _, n := range groups {
		if n > 1 {
			t.DuplicatePeriodEnds++
		}
	}
	return t
}

// PostRepairVerdict passes only when no stored row ends after its filing, no two rows of a symbol
// and period type share a period_end, and every symbol outside failed is planned with no change.
func PostRepairVerdict(report Report, failed []string) Verdict {
	v := Verdict{Reasons: []string{}}
	if n := report.Totals.EndAfterFiled; n > 0 {
		v.Reasons = append(v.Reasons, fmt.Sprintf("%d stored rows have period_end after filed_date", n))
	}
	if n := report.Totals.DuplicatePeriodEnds; n > 0 {
		v.Reasons = append(v.Reasons, fmt.Sprintf("%d groups of rows of one symbol and period type share a period_end", n))
	}
	for _, sr := range report.Symbols {
		if slices.Contains(failed, sr.Symbol) {
			continue
		}
		switch {
		case sr.DeriveError != "":
			v.Reasons = append(v.Reasons, fmt.Sprintf("%s could not be planned: %s", sr.Symbol, sr.DeriveError))
		case sr.Guard != "":
			v.Reasons = append(v.Reasons, fmt.Sprintf("%s could not be planned: %s", sr.Symbol, sr.Guard))
		case sr.Deletes > 0 || sr.Inserts > 0:
			v.Reasons = append(v.Reasons, fmt.Sprintf("%s plans %d deletes and %d inserts", sr.Symbol, sr.Deletes, sr.Inserts))
		}
	}
	v.Pass = len(v.Reasons) == 0
	return v
}

// DiffReport counts, per price-join column, the rows whose value became null across a repair.
type DiffReport struct {
	ValueToNull  map[string]int `json:"value_to_null"`
	Compared     int            `json:"compared"`
	Ambiguous    int            `json:"ambiguous_keys"`
	UnmatchedPre int            `json:"pre_rows_without_post_row"`
}

// Diff matches pre and post rows on (symbol, period_type, filed_date): price and dividend yield
// depend on nothing else. A key with several rows on either side is ambiguous and not compared.
func Diff(pre, post map[string][]source.HistoricalPriceState) DiffReport {
	type key struct{ symbol, periodType, filed string }
	index := func(rows map[string][]source.HistoricalPriceState) map[key][]source.HistoricalPriceState {
		out := map[key][]source.HistoricalPriceState{}
		for symbol, stored := range rows {
			for _, row := range stored {
				k := key{symbol, row.PeriodType, day(row.FiledDate)}
				out[k] = append(out[k], row)
			}
		}
		return out
	}
	before, after := index(pre), index(post)
	report := DiffReport{ValueToNull: map[string]int{colPrice: 0, colMarketCap: 0, colPERatio: 0, colPBRatio: 0, colDividendYield: 0}}
	for k, rows := range before {
		switch {
		case len(rows) > 1 || len(after[k]) > 1:
			report.Ambiguous++
		case len(after[k]) == 0:
			report.UnmatchedPre++
		default:
			report.Compared++
			was, is := rows[0], after[k][0]
			for column, pair := range map[string][2]*float64{
				colPrice: {was.Price, is.Price}, colMarketCap: {was.MarketCap, is.MarketCap}, colPERatio: {was.PERatio, is.PERatio},
				colPBRatio: {was.PBRatio, is.PBRatio}, colDividendYield: {was.DividendYield, is.DividendYield},
			} {
				if pair[0] != nil && pair[1] == nil {
					report.ValueToNull[column]++
				}
			}
		}
	}
	return report
}
