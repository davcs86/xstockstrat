//go:build dbtest

package repository

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// dbtestSymbolPrefix scopes every seeded row so cleanup never touches data the tests did not create.
const dbtestSymbolPrefix = "ZZ348_"

// dbtestRepo connects to the migrated database at MARKETDATA_DB_TEST_URL in exec mode, the mode
// production runs behind PgBouncer. Unset under CI=true is fatal: a skip is not evidence.
func dbtestRepo(t *testing.T) *MarketDataRepo {
	t.Helper()
	url := os.Getenv("MARKETDATA_DB_TEST_URL")
	if url == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("MARKETDATA_DB_TEST_URL is unset under CI=true; the marketdata-db-test job must provide it")
		}
		t.Skip("MARKETDATA_DB_TEST_URL unset; skipping real-Postgres test")
	}
	t.Setenv("DB_PGBOUNCER", "true")
	repo, err := NewMarketDataRepo(url)
	if err != nil {
		t.Fatalf("NewMarketDataRepo: %v", err)
	}
	t.Cleanup(func() {
		if _, err := repo.db.Exec(context.Background(), `DELETE FROM marketdata.fundamentals_history WHERE symbol LIKE $1`, dbtestSymbolPrefix+"%"); err != nil {
			t.Errorf("cleanup: %v", err)
		}
		repo.pool.Close()
	})
	return repo
}

func dbtestPeriod(symbol, label string, end, filed time.Time, version int, netIncome, equity float64) source.HistoricalFundamentalsPeriod {
	return source.HistoricalFundamentalsPeriod{
		Symbol: symbol, FiscalPeriod: label, PeriodType: "quarterly", PeriodEnd: end, FiledDate: filed,
		Source: "edgar", Currency: "USD", DerivationVersion: version,
		ExtraMetrics: map[string]float64{"net_income": netIncome, "stockholders_equity": equity},
	}
}

// dbtestSeedCollided stores the ORCL-shaped collided row (version 2) and returns it as listed.
func dbtestSeedCollided(t *testing.T, repo *MarketDataRepo, symbol string) source.HistoricalPriceState {
	t.Helper()
	ctx := context.Background()
	collided := dbtestPeriod(symbol, "Q1-2026", hfDay(2026, 9, 7), hfDay(2025, 9, 10), 2, 4760000000, 66772000000)
	if err := repo.ReplaceHistoricalFundamentals(ctx, symbol, nil, []source.HistoricalFundamentalsPeriod{collided}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	rows, err := repo.ListHistoricalRows(ctx, symbol)
	if err != nil || len(rows) != 1 {
		t.Fatalf("seed read: %d rows, err %v", len(rows), err)
	}
	return rows[0]
}

func dbtestCorrected(symbol string) []source.HistoricalFundamentalsPeriod {
	return []source.HistoricalFundamentalsPeriod{
		dbtestPeriod(symbol, "Q1-2026", hfDay(2025, 8, 31), hfDay(2025, 9, 10), 3, 2927000000, 24154000000),
		dbtestPeriod(symbol, "Q1-2027", hfDay(2026, 8, 31), hfDay(2026, 9, 11), 3, 4760000000, 66772000000),
	}
}

// dbtestSnapshot lists a symbol's rows as comparable strings.
func dbtestSnapshot(t *testing.T, repo *MarketDataRepo, symbol string) []string {
	t.Helper()
	rows, err := repo.ListHistoricalRows(context.Background(), symbol)
	if err != nil {
		t.Fatalf("ListHistoricalRows: %v", err)
	}
	out := []string{}
	for _, r := range rows {
		out = append(out, fmt.Sprintf("%s|%s|%s|%s|v%d|%.0f", r.FiscalPeriod, r.PeriodType, r.PeriodEnd.Format(time.DateOnly), r.FiledDate.Format(time.DateOnly), r.DerivationVersion, r.ExtraMetrics["stockholders_equity"]))
	}
	return out
}

func dbtestCount(t *testing.T, repo *MarketDataRepo, query, symbol string) int {
	t.Helper()
	var n int
	if err := repo.db.QueryRow(context.Background(), query, symbol).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// @AC-5, @AC-7: on a real database the replace swaps the collided row for both corrected periods,
// and the documented audit counts go from 1 to 0.
func TestReplaceHistoricalFundamentals_RealDB_AC5_AC7_feature348(t *testing.T) {
	repo := dbtestRepo(t)
	ctx := context.Background()
	const endAfterFiled = `SELECT count(*) FROM marketdata.fundamentals_history WHERE period_end > filed_date AND symbol = $1`
	const duplicateEnds = `SELECT count(*) FROM (SELECT symbol, period_type, period_end FROM marketdata.fundamentals_history
		WHERE symbol = $1 GROUP BY symbol, period_type, period_end HAVING count(*) > 1) d`
	symbol := dbtestSymbolPrefix + "ORCL"
	collided := dbtestSeedCollided(t, repo, symbol)
	if n := dbtestCount(t, repo, endAfterFiled, symbol); n != 1 {
		t.Fatalf("rows with period_end > filed_date before the replace = %d, want 1", n)
	}

	if err := repo.ReplaceHistoricalFundamentals(ctx, symbol, []source.HistoricalPriceState{collided}, dbtestCorrected(symbol)); err != nil {
		t.Fatalf("ReplaceHistoricalFundamentals: %v", err)
	}
	want := []string{
		"Q1-2026|quarterly|2025-08-31|2025-09-10|v3|24154000000",
		"Q1-2027|quarterly|2026-08-31|2026-09-11|v3|66772000000",
	}
	if got := dbtestSnapshot(t, repo, symbol); !slices.Equal(got, want) {
		t.Errorf("stored rows = %v, want %v", got, want)
	}
	if n := dbtestCount(t, repo, endAfterFiled, symbol); n != 0 {
		t.Errorf("rows with period_end > filed_date after the replace = %d, want 0", n)
	}
	if n := dbtestCount(t, repo, duplicateEnds, symbol); n != 0 {
		t.Errorf("(symbol, period_type, period_end) groups with more than one row = %d, want 0", n)
	}

	// D-13: the same plan a second time misses its pinned delete and changes nothing.
	err := repo.ReplaceHistoricalFundamentals(ctx, symbol, []source.HistoricalPriceState{collided}, dbtestCorrected(symbol))
	if err == nil || !strings.Contains(err.Error(), "removed 0 rows, want 1") {
		t.Errorf("second run of the same plan: err = %v, want the pinned delete to miss", err)
	}
	if got := dbtestSnapshot(t, repo, symbol); !slices.Equal(got, want) {
		t.Errorf("stored rows after the failed second run = %v, want them unchanged %v", got, want)
	}
}

// A replace that cannot run whole changes nothing.
func TestReplaceHistoricalFundamentals_RealDB_RollsBack_feature348(t *testing.T) {
	repo := dbtestRepo(t)
	ctx := context.Background()
	type plan func(symbol string, collided source.HistoricalPriceState) ([]source.HistoricalPriceState, []source.HistoricalFundamentalsPeriod)
	for name, build := range map[string]plan{
		"pinned delete with another version": func(symbol string, collided source.HistoricalPriceState) ([]source.HistoricalPriceState, []source.HistoricalFundamentalsPeriod) {
			collided.DerivationVersion = 1
			return []source.HistoricalPriceState{collided}, dbtestCorrected(symbol)[:1]
		},
		"pinned delete with another period_end": func(symbol string, collided source.HistoricalPriceState) ([]source.HistoricalPriceState, []source.HistoricalFundamentalsPeriod) {
			collided.PeriodEnd = hfDay(2026, 9, 8)
			return []source.HistoricalPriceState{collided}, dbtestCorrected(symbol)[:1]
		},
		// The stored Q1-2027 row is not in the deletes, so its insert hits a taken key and the
		// delete of Q1-2026 that ran before it is rolled back.
		"insert on a key that is still stored": func(symbol string, collided source.HistoricalPriceState) ([]source.HistoricalPriceState, []source.HistoricalFundamentalsPeriod) {
			return []source.HistoricalPriceState{collided}, dbtestCorrected(symbol)
		},
	} {
		symbol := dbtestSymbolPrefix + strings.ReplaceAll(name, " ", "_")
		collided := dbtestSeedCollided(t, repo, symbol)
		stale := dbtestPeriod(symbol, "Q1-2027", hfDay(2026, 9, 6), hfDay(2026, 9, 11), 2, 4760000000, 66772000000)
		if err := repo.ReplaceHistoricalFundamentals(ctx, symbol, nil, []source.HistoricalFundamentalsPeriod{stale}); err != nil {
			t.Fatalf("%s: seed second row: %v", name, err)
		}
		before := dbtestSnapshot(t, repo, symbol)
		if len(before) != 2 {
			t.Fatalf("%s: seeded rows = %v, want 2", name, before)
		}
		deletes, inserts := build(symbol, collided)
		if err := repo.ReplaceHistoricalFundamentals(ctx, symbol, deletes, inserts); err == nil {
			t.Errorf("%s: no error", name)
		}
		if after := dbtestSnapshot(t, repo, symbol); !slices.Equal(after, before) {
			t.Errorf("%s: stored rows = %v, want them unchanged %v", name, after, before)
		}
	}
}
