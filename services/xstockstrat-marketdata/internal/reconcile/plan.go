// Package reconcile plans how one symbol's stored historical-fundamentals rows are brought in line
// with a freshly derived period set. It is pure: no I/O, no logging, no clock.
package reconcile

import (
	"errors"
	"sort"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// Guard errors: the symbol fails and nothing is written.
var (
	ErrFreshEmpty    = errors.New("reconcile: stored rows exist but no period was derived")
	ErrTypeMissing   = errors.New("reconcile: stored rows of a requested period type exist but none was derived")
	ErrFilerMismatch = errors.New("reconcile: no stored reported value matches a derived period")
)

// Categories of a deleted row whose period is not stored again.
const (
	CategoryLeftOut           = "left_out"
	CategoryMerged            = "merged"
	CategoryPeriodTypeChanged = "period_type_changed"
	CategoryNoPeriodDerived   = "no_period_derived"
)

// filerKeys are the reported values compared to tell one filer from another.
var filerKeys = []string{"net_income", "revenue", "assets", "liabilities", "stockholders_equity"}

// Request scopes a plan. A zero From or To leaves that side of the period_end range open.
type Request struct {
	PeriodTypes []string
	From, To    time.Time
	LeftOut     []source.LeftOutPeriod
}

// Pair is a stored row and the fresh period it equals on (label, type, period_end, filed_date).
type Pair struct {
	Stored source.HistoricalPriceState
	Fresh  source.HistoricalFundamentalsPeriod
}

// Unreplaced is a deleted row whose period is not stored again.
type Unreplaced struct {
	Row      source.HistoricalPriceState
	Category string
}

// Plan lists Deletes and Inserts sorted by (fiscal_period, period_type); Identical holds only the
// pairs inside the request range.
type Plan struct {
	Identical  []Pair
	Deletes    []source.HistoricalPriceState
	Inserts    []source.HistoricalFundamentalsPeriod
	Unreplaced []Unreplaced
}

type identity struct{ label, periodType, end, filed string }

type typeDay struct{ periodType, day string }

func day(t time.Time) string { return t.Format(time.DateOnly) }

// Build returns the plan for one symbol, or a guard error with an empty plan.
func Build(stored []source.HistoricalPriceState, fresh []source.HistoricalFundamentalsPeriod, req Request) (Plan, error) {
	wantQuarterly, wantAnnual := source.PeriodTypesWanted(req.PeriodTypes)
	wanted := func(periodType string) bool {
		return (periodType == source.PeriodQuarterly && wantQuarterly) || (periodType == source.PeriodAnnual && wantAnnual)
	}
	if err := guard(stored, fresh, wanted); err != nil {
		return Plan{}, err
	}

	freshByID := make(map[identity]int, len(fresh))
	current := 0
	for i, p := range fresh {
		freshByID[identity{p.FiscalPeriod, p.PeriodType, day(p.PeriodEnd), day(p.FiledDate)}] = i
		current = max(current, p.DerivationVersion)
	}
	inRange := func(end time.Time) bool {
		e := day(end)
		return (req.From.IsZero() || e >= day(req.From)) && (req.To.IsZero() || e <= day(req.To))
	}

	var plan Plan
	matched := make(map[int]bool, len(fresh))
	deletedAt := map[typeDay]bool{}
	belowCurrent := false
	for _, row := range stored {
		if !wanted(row.PeriodType) {
			continue
		}
		if i, ok := freshByID[identity{row.FiscalPeriod, row.PeriodType, day(row.PeriodEnd), day(row.FiledDate)}]; ok {
			matched[i] = true
			if inRange(row.PeriodEnd) {
				plan.Identical = append(plan.Identical, Pair{Stored: row, Fresh: fresh[i]})
			}
			continue
		}
		plan.Deletes = append(plan.Deletes, row)
		deletedAt[typeDay{row.PeriodType, day(row.PeriodEnd)}] = true
		belowCurrent = belowCurrent || row.DerivationVersion < current
	}
	sort.SliceStable(plan.Deletes, func(i, j int) bool {
		a, b := plan.Deletes[i], plan.Deletes[j]
		if a.FiscalPeriod != b.FiscalPeriod {
			return a.FiscalPeriod < b.FiscalPeriod
		}
		return a.PeriodType < b.PeriodType
	})

	for i, p := range fresh {
		if !wanted(p.PeriodType) || matched[i] {
			continue
		}
		if inRange(p.PeriodEnd) || deletedAt[typeDay{p.PeriodType, day(p.PeriodEnd)}] || belowCurrent {
			plan.Inserts = append(plan.Inserts, p)
		}
	}
	sort.SliceStable(plan.Inserts, func(i, j int) bool {
		a, b := plan.Inserts[i], plan.Inserts[j]
		if a.FiscalPeriod != b.FiscalPeriod {
			return a.FiscalPeriod < b.FiscalPeriod
		}
		return a.PeriodType < b.PeriodType
	})

	plan.Unreplaced = unreplaced(plan, fresh, matched, req.LeftOut)
	return plan, nil
}

func guard(stored []source.HistoricalPriceState, fresh []source.HistoricalFundamentalsPeriod, wanted func(string) bool) error {
	if len(stored) == 0 {
		return nil
	}
	if len(fresh) == 0 {
		return ErrFreshEmpty
	}
	freshTypes := map[string]bool{}
	for _, p := range fresh {
		freshTypes[p.PeriodType] = true
	}
	requestedStored := false
	for _, row := range stored {
		if !wanted(row.PeriodType) {
			continue
		}
		requestedStored = true
		if !freshTypes[row.PeriodType] {
			return ErrTypeMissing
		}
	}
	if !requestedStored {
		return nil
	}
	for _, row := range stored {
		for _, k := range filerKeys {
			v, ok := row.ExtraMetrics[k]
			if !ok || v == 0 {
				continue
			}
			for _, p := range fresh {
				if fv, has := p.ExtraMetrics[k]; has && fv == v {
					return nil
				}
			}
		}
	}
	return ErrFilerMismatch
}

// unreplaced pairs deleted rows with the stored-again periods of their type and filed_date in
// period_end order; a period replaces at most one row, and the rows left over get a category.
func unreplaced(plan Plan, fresh []source.HistoricalFundamentalsPeriod, matched map[int]bool, leftOut []source.LeftOutPeriod) []Unreplaced {
	available := map[typeDay]int{}
	for i := range fresh {
		if matched[i] {
			available[typeDay{fresh[i].PeriodType, day(fresh[i].FiledDate)}]++
		}
	}
	for _, p := range plan.Inserts {
		available[typeDay{p.PeriodType, day(p.FiledDate)}]++
	}
	freshFiled := map[typeDay]bool{}
	for _, p := range fresh {
		freshFiled[typeDay{p.PeriodType, day(p.FiledDate)}] = true
	}
	leftOutAt := map[typeDay]bool{}
	for _, lo := range leftOut {
		leftOutAt[typeDay{lo.PeriodType, day(lo.PeriodEnd)}] = true
		leftOutAt[typeDay{lo.PeriodType, day(lo.FiledDate)}] = true
	}

	byEnd := make([]int, len(plan.Deletes))
	for i := range byEnd {
		byEnd[i] = i
	}
	sort.SliceStable(byEnd, func(i, j int) bool {
		return day(plan.Deletes[byEnd[i]].PeriodEnd) < day(plan.Deletes[byEnd[j]].PeriodEnd)
	})
	replaced := make([]bool, len(plan.Deletes))
	for _, i := range byEnd {
		k := typeDay{plan.Deletes[i].PeriodType, day(plan.Deletes[i].FiledDate)}
		if available[k] > 0 {
			available[k]--
			replaced[i] = true
		}
	}

	var out []Unreplaced
	for i, row := range plan.Deletes {
		if replaced[i] {
			continue
		}
		other := source.PeriodAnnual
		if row.PeriodType == source.PeriodAnnual {
			other = source.PeriodQuarterly
		}
		filed := day(row.FiledDate)
		category := CategoryNoPeriodDerived
		switch {
		case leftOutAt[typeDay{row.PeriodType, day(row.PeriodEnd)}] || leftOutAt[typeDay{row.PeriodType, filed}]:
			category = CategoryLeftOut
		case freshFiled[typeDay{row.PeriodType, filed}]:
			category = CategoryMerged
		case freshFiled[typeDay{other, filed}]:
			category = CategoryPeriodTypeChanged
		}
		out = append(out, Unreplaced{Row: row, Category: category})
	}
	return out
}
