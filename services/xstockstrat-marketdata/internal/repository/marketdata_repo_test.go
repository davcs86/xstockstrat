package repository

import (
	"context"
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
