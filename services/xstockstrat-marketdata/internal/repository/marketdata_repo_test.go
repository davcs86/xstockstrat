package repository

import (
	"strings"
	"testing"
	"time"
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
