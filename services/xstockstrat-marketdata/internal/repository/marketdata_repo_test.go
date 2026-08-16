package repository

import (
	"context"
	"strings"
	"testing"
	"time"

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

// TestUpsertFundamentals_CastsExtraMetricsToJSONB is a SQL-text pin, not a live-Postgres
// proof — pgxmock never runs pgx's real extended-protocol encoder or talks to real
// Postgres, so it structurally cannot catch the OID-inference bug class this feature
// fixes (see the feature's context.md for the live-DB repro that actually proved the
// fix — feature 142). This test only guards against someone deleting the ::jsonb cast
// later.
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
