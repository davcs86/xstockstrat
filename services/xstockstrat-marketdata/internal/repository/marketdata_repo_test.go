package repository

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/xstockstrat/marketdata/internal/source"
)

// TestBuildDeleteBarsQuery verifies the scoped DELETE predicate building for DeleteBars (FR-5).
// The DBA-critical invariant — the symbol predicate is ALWAYS present and is always $1, so a
// full-table delete can never be issued — is asserted across every variant.
func TestBuildDeleteBarsQuery(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name           string
		symbol         string
		timeframe      string
		start          time.Time
		end            time.Time
		wantContains   []string
		wantNotContain []string
		wantArgs       int
	}{
		{
			name:           "symbol only (whole-symbol delete, all timeframes)",
			symbol:         "AAPL",
			wantContains:   []string{"DELETE FROM marketdata.ohlcv WHERE symbol=$1"},
			wantNotContain: []string{"timeframe=", "time >=", "time <="},
			wantArgs:       1,
		},
		{
			name:           "symbol + timeframe",
			symbol:         "AAPL",
			timeframe:      "1d",
			wantContains:   []string{"symbol=$1", "AND timeframe=$2"},
			wantNotContain: []string{"time >=", "time <="},
			wantArgs:       2,
		},
		{
			name:         "symbol + range (all timeframes)",
			symbol:       "TSLA",
			start:        start,
			end:          end,
			wantContains: []string{"symbol=$1", "AND time >= $2", "AND time <= $3"},
			wantArgs:     3,
		},
		{
			name:         "symbol + timeframe + range",
			symbol:       "NVDA",
			timeframe:    "1h",
			start:        start,
			end:          end,
			wantContains: []string{"symbol=$1", "AND timeframe=$2", "AND time >= $3", "AND time <= $4"},
			wantArgs:     4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sql, args := buildDeleteBarsQuery(tt.symbol, tt.timeframe, tt.start, tt.end)

			// Safety invariant: symbol predicate always present, always $1, always the first arg.
			if !strings.Contains(sql, "WHERE symbol=$1") {
				t.Fatalf("symbol predicate missing — refuses to guard against full-table delete: %q", sql)
			}
			if len(args) == 0 || args[0] != tt.symbol {
				t.Fatalf("first arg must be the symbol %q, got %v", tt.symbol, args)
			}
			if len(args) != tt.wantArgs {
				t.Fatalf("want %d args, got %d (%v)", tt.wantArgs, len(args), args)
			}
			for _, sub := range tt.wantContains {
				if !strings.Contains(sql, sub) {
					t.Errorf("sql %q missing %q", sql, sub)
				}
			}
			for _, sub := range tt.wantNotContain {
				if strings.Contains(sql, sub) {
					t.Errorf("sql %q must not contain %q", sql, sub)
				}
			}
		})
	}
}

// isStringArg matches a bind argument only if it's a Go string — the type pgx's
// QueryExecModeExec must see to encode a parameter as `text` (not `bytea`). A []byte
// argument here is bytea-typed on the wire; bytea::jsonb casts through bytea's hex-escaped
// text representation, which is never valid JSON. This is the actual regression this test
// guards: `::jsonb` in the SQL text alone (pinned before) was NOT sufficient — the deployed
// fix based on that alone still failed with SQLSTATE 22P02 in production (see the feature's
// context.md) until the bind argument was also changed from []byte to string.
type isStringArg struct{}

func (isStringArg) Match(v any) bool {
	_, ok := v.(string)
	return ok
}

// TestUpsertFundamentals_CastsExtraMetricsToJSONB is a SQL-text + arg-type pin, not a
// live-Postgres proof — pgxmock never runs pgx's real extended-protocol encoder or talks
// to real Postgres, so it structurally cannot catch every shape of the OID-inference bug
// class this feature fixes (see the feature's context.md for the live-DB repro that
// actually proves the fix — feature 142). This test guards against both known regressions:
// deleting the ::jsonb cast, and reverting extra_metrics' bind argument back to []byte.
func TestUpsertFundamentals_CastsExtraMetricsToJSONB(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	repo := &MarketDataRepo{db: mock}

	anyArgs := make([]any, 16)
	for i := range anyArgs {
		anyArgs[i] = pgxmock.AnyArg()
	}
	anyArgs[13] = isStringArg{} // extra_metrics ($14, 0-indexed 13) — must be string, not []byte
	mock.ExpectExec(`\$14::jsonb`).
		WithArgs(anyArgs...).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err = repo.UpsertFundamentals(context.Background(), &source.Fundamentals{
		Symbol:       "UPRO",
		ExtraMetrics: map[string]float64{},
		Source:       "finnhub",
	})
	if err != nil {
		t.Fatalf("UpsertFundamentals: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet (query text missing the ::jsonb cast): %v", err)
	}
}

// feature 095 — GetPreviousDailyClose reads the second-newest 1d bar's close (prior session),
// and reports ok=false (never a fabricated 0) when fewer than two daily bars are stored.
func TestGetPreviousDailyClose(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &MarketDataRepo{db: mock}

	// Present: OFFSET 1 LIMIT 1 returns the prior session's close.
	mock.ExpectQuery(`OFFSET 1 LIMIT 1`).
		WithArgs("CAPR").
		WillReturnRows(pgxmock.NewRows([]string{"close"}).AddRow(12.09))
	got, ok, err := repo.GetPreviousDailyClose(context.Background(), "CAPR")
	if err != nil || !ok || got != 12.09 {
		t.Fatalf("expected (12.09,true,nil), got (%v,%v,%v)", got, ok, err)
	}

	// Absent: no prior bar → ok=false, value 0, no error (AC-11 omit-not-fabricate).
	mock.ExpectQuery(`OFFSET 1 LIMIT 1`).
		WithArgs("NEW").
		WillReturnError(pgx.ErrNoRows)
	got, ok, err = repo.GetPreviousDailyClose(context.Background(), "NEW")
	if err != nil || ok || got != 0 {
		t.Fatalf("expected (0,false,nil) on no rows, got (%v,%v,%v)", got, ok, err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet: %v", err)
	}
}

// --- Feature 204: QueryHistoricalFundamentals composite-cursor pagination ---
//
// These are SQL-text + arg + control-flow pins over pgxmock (like TestUpsertFundamentals above):
// pgxmock does not run Postgres, so "asOf excludes rows" and the ORDER BY are asserted as the SQL
// the repo *builds* (predicate present, asOf bound before LIMIT), while the overfetch→trim→nextToken
// logic and the composite-cursor boundary are driven directly through the returned rows.

func histMockCols() []string {
	return strings.Split(strings.ReplaceAll(histFundamentalsColumns, " ", ""), ",")
}

// histMockRow appends one fundamentals_history row in histFundamentalsColumns order. Only the
// identity + date columns matter for pagination; the 11 nullable metric columns + extra_metrics are NULL.
func histMockRow(rows *pgxmock.Rows, symbol, fp, ptype string, periodEnd, filed time.Time) *pgxmock.Rows {
	return rows.AddRow(
		symbol, fp, ptype, periodEnd, filed,
		nil,                                                   // accepted_date
		"edgar",                                               // source
		"USD",                                                 // currency
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, // market_cap..year_low (11)
		nil, // extra_metrics
	)
}

func hfDay(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// AC-20/AC-21: first page overfetches pageSize+1, returns exactly pageSize rows with a nextToken
// derived from the LAST RETURNED row; the follow-up page resumes strictly after that cursor and,
// once the remainder fits, returns an empty nextToken. An empty page token starts at the first page.
func TestQueryHistoricalFundamentals_Pagination(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &MarketDataRepo{db: mock}
	cols := histMockCols()

	pe1, pe2, pe3 := hfDay(2024, 3, 31), hfDay(2024, 6, 30), hfDay(2024, 9, 30)
	filed := hfDay(2024, 12, 1)

	// Page 1: empty token → no cursor predicate; overfetch LIMIT is pageSize+1 (=3). Return 3 rows.
	page1 := histMockRow(pgxmock.NewRows(cols), "AAPL", "Q1-2024", "quarterly", pe1, filed)
	histMockRow(page1, "AAPL", "Q2-2024", "quarterly", pe2, filed)
	histMockRow(page1, "AAPL", "Q3-2024", "quarterly", pe3, filed)
	mock.ExpectQuery(`ORDER BY period_end, fiscal_period LIMIT \$2`).
		WithArgs("AAPL", 3).
		WillReturnRows(page1)

	rows, next, err := repo.QueryHistoricalFundamentals(context.Background(), "AAPL", time.Time{}, time.Time{}, time.Time{}, nil, 2, "")
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("page 1: got %d rows, want 2 (trimmed from the pageSize+1 overfetch)", len(rows))
	}
	wantNext := fmt.Sprintf("%s|%s", pe2.Format(time.RFC3339Nano), "Q2-2024")
	if next != wantNext {
		t.Fatalf("page 1 nextToken = %q, want %q (cursor is the LAST RETURNED row, not the overfetched sentinel)", next, wantNext)
	}

	// Page 2: token decodes to (pe2, "Q2-2024"); the cursor is bound BEFORE the LIMIT. Only 1 row
	// remains (≤ pageSize) → empty nextToken.
	page2 := histMockRow(pgxmock.NewRows(cols), "AAPL", "Q3-2024", "quarterly", pe3, filed)
	mock.ExpectQuery(`\(period_end, fiscal_period\) > \(\$2, \$3\).*ORDER BY period_end, fiscal_period LIMIT \$4`).
		WithArgs("AAPL", pgxmock.AnyArg(), "Q2-2024", 3).
		WillReturnRows(page2)

	rows, next, err = repo.QueryHistoricalFundamentals(context.Background(), "AAPL", time.Time{}, time.Time{}, time.Time{}, nil, 2, next)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if len(rows) != 1 || rows[0].FiscalPeriod != "Q3-2024" {
		t.Fatalf("page 2: got %d rows (first=%v), want 1 (Q3-2024)", len(rows), rows)
	}
	if next != "" {
		t.Fatalf("page 2 nextToken = %q, want empty (no further page)", next)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet: %v", err)
	}
}

// AC-20: the as_of no-look-ahead filter is pushed into SQL (filed_date < $asOf) and bound BEFORE the
// LIMIT, so a short page can never be an artifact of a post-LIMIT filter dropping rows.
func TestQueryHistoricalFundamentals_AsOfPushedIntoSQL(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &MarketDataRepo{db: mock}
	cols := histMockCols()

	asOf := hfDay(2024, 5, 1)
	rows := histMockRow(pgxmock.NewRows(cols), "AAPL", "Q1-2024", "quarterly", hfDay(2024, 3, 31), hfDay(2024, 4, 15))
	// filed_date < $2 (asOf) appears before the LIMIT clause; LIMIT is then $3 (pageSize+1).
	mock.ExpectQuery(`filed_date < \$2.*ORDER BY period_end, fiscal_period LIMIT \$3`).
		WithArgs("AAPL", pgxmock.AnyArg(), 2).
		WillReturnRows(rows)

	out, next, err := repo.QueryHistoricalFundamentals(context.Background(), "AAPL", asOf, time.Time{}, time.Time{}, nil, 1, "")
	if err != nil {
		t.Fatalf("as-of query: %v", err)
	}
	if len(out) != 1 || next != "" {
		t.Fatalf("got %d rows / next %q, want 1 / empty", len(out), next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet (as_of predicate missing before LIMIT): %v", err)
	}
}

// AC-21: two rows sharing a period_end but differing in fiscal_period (annual FY vs Q4) are never
// skipped or duplicated at a page boundary — the composite cursor's fiscal_period tiebreaker resumes
// exactly after the last returned row. A period_end-ONLY cursor would skip the same-day sibling; this
// pins that the cursor binds BOTH columns and that the sibling is returned on the next page.
func TestQueryHistoricalFundamentals_CompositeCursorSamePeriodEnd(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &MarketDataRepo{db: mock}
	cols := histMockCols()

	shared := hfDay(2019, 12, 31) // FY2019 and Q4-2019 both end here
	filed := hfDay(2020, 3, 1)

	// Page 1 (pageSize 1): overfetch LIMIT 2 returns [FY2019, Q4-2019] in (period_end, fiscal_period)
	// order ('F' < 'Q'). Trimmed to [FY2019]; cursor is (2019-12-31, "FY2019").
	page1 := histMockRow(pgxmock.NewRows(cols), "AAPL", "FY2019", "annual", shared, filed)
	histMockRow(page1, "AAPL", "Q4-2019", "quarterly", shared, filed)
	mock.ExpectQuery(`ORDER BY period_end, fiscal_period LIMIT \$2`).
		WithArgs("AAPL", 2).
		WillReturnRows(page1)

	rows, next, err := repo.QueryHistoricalFundamentals(context.Background(), "AAPL", time.Time{}, time.Time{}, time.Time{}, nil, 1, "")
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(rows) != 1 || rows[0].FiscalPeriod != "FY2019" {
		t.Fatalf("page 1: got %v, want single FY2019", rows)
	}
	if want := fmt.Sprintf("%s|%s", shared.Format(time.RFC3339Nano), "FY2019"); next != want {
		t.Fatalf("page 1 nextToken = %q, want %q", next, want)
	}

	// Page 2: the cursor must bind fiscal_period "FY2019" (3rd arg) — proving it is part of the cursor,
	// not period_end alone — and the same-period_end sibling Q4-2019 is returned, not skipped.
	page2 := histMockRow(pgxmock.NewRows(cols), "AAPL", "Q4-2019", "quarterly", shared, filed)
	mock.ExpectQuery(`\(period_end, fiscal_period\) > \(\$2, \$3\)`).
		WithArgs("AAPL", pgxmock.AnyArg(), "FY2019", 2).
		WillReturnRows(page2)

	rows, next, err = repo.QueryHistoricalFundamentals(context.Background(), "AAPL", time.Time{}, time.Time{}, time.Time{}, nil, 1, next)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if len(rows) != 1 || rows[0].FiscalPeriod != "Q4-2019" {
		t.Fatalf("page 2: got %v, want the same-period_end sibling Q4-2019 (not skipped)", rows)
	}
	if next != "" {
		t.Fatalf("page 2 nextToken = %q, want empty", next)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock expectations unmet: %v", err)
	}
}

// parseHistCursor round-trips the encoded "<period_end RFC3339Nano>|<fiscal_period>" token and is
// lenient on empty/malformed tokens (resume from the first page rather than error — QueryBars parity).
func TestParseHistCursor(t *testing.T) {
	pe := hfDay(2024, 6, 30)
	token := fmt.Sprintf("%s|%s", pe.Format(time.RFC3339Nano), "Q2-2024")
	gotPE, gotFP, ok := parseHistCursor(token)
	if !ok || gotFP != "Q2-2024" || !gotPE.Equal(pe) {
		t.Fatalf("round-trip: got (%v, %q, %v), want (%v, Q2-2024, true)", gotPE, gotFP, ok, pe)
	}
	// A fiscal_period may itself contain a hyphen; the split is on the FIRST '|' only.
	if _, fp, ok := parseHistCursor("2024-06-30T00:00:00Z|FY-2024-restated"); !ok || fp != "FY-2024-restated" {
		t.Errorf("split-on-first-pipe: got fp=%q ok=%v, want FY-2024-restated/true", fp, ok)
	}
	for _, bad := range []string{"", "no-separator", "not-a-date|Q2-2024"} {
		if _, _, ok := parseHistCursor(bad); ok {
			t.Errorf("parseHistCursor(%q) ok=true, want false (lenient reject)", bad)
		}
	}
}
