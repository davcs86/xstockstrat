package service

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

func TestEstimateExpectedBars(t *testing.T) {
	// Mon 2024-01-01 .. Fri 2024-01-05 inclusive = 5 weekdays (no weekend).
	monStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	friEnd := time.Date(2024, 1, 5, 0, 0, 0, 0, time.UTC)
	// Mon 2024-01-01 .. Sun 2024-01-07 inclusive = 5 weekdays (Sat+Sun excluded).
	weekEnd := time.Date(2024, 1, 7, 0, 0, 0, 0, time.UTC)

	tests := []struct {
		name      string
		symbols   []string
		timeframe string
		start     time.Time
		end       time.Time
		want      int64
	}{
		{"1d single symbol 5 weekdays", []string{"AAPL"}, "1d", monStart, friEnd, 5},
		{"1d two symbols", []string{"AAPL", "TSLA"}, "1d", monStart, friEnd, 10},
		{"weekend excluded", []string{"AAPL"}, "1d", monStart, weekEnd, 5},
		{"1h factor 7", []string{"AAPL"}, "1h", monStart, friEnd, 35},
		{"5m factor 78", []string{"AAPL"}, "5m", monStart, friEnd, 390},
		{"1m factor 390", []string{"AAPL"}, "1m", monStart, friEnd, 1950},
		{"1Day alias", []string{"AAPL"}, "1Day", monStart, friEnd, 5},
		{"unknown timeframe defaults to 1", []string{"AAPL"}, "monthly", monStart, friEnd, 5},
		{"no symbols", []string{}, "1d", monStart, friEnd, 0},
		{"end before start", []string{"AAPL"}, "1d", friEnd, monStart, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := estimateExpectedBars(tt.symbols, tt.timeframe, tt.start, tt.end)
			if got != tt.want {
				t.Errorf("estimateExpectedBars(%v, %q) = %d, want %d", tt.symbols, tt.timeframe, got, tt.want)
			}
		})
	}
}

// rng builds a common.v1.TimeRange from two times (nil-safe via zero check).
func rng(start, end time.Time) *commonv1.TimeRange {
	return &commonv1.TimeRange{Start: timestamppb.New(start), End: timestamppb.New(end)}
}

// TestResolveDeletePlan exercises the FR-5 server-side guards for DeleteBackfilledData without a
// DB or config server: symbol required (unbounded reject), admin-only (0x04), the delete-window
// cap, and timeframe/range resolution.
func TestResolveDeletePlan(t *testing.T) {
	day := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Run("empty symbol is rejected as InvalidArgument", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("missing admin bit is rejected as PermissionDenied", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "0", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("want PermissionDenied, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("empty access scope is rejected as PermissionDenied", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("want PermissionDenied, got %v", connect.CodeOf(err))
		}
	})

	t.Run("admin whole-symbol (no range, all timeframes) is accepted", func(t *testing.T) {
		canonical, start, end, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, nil, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if canonical != "" || !start.IsZero() || !end.IsZero() {
			t.Fatalf("want empty plan, got canonical=%q start=%v end=%v", canonical, start, end)
		}
	})

	t.Run("timeframe is resolved to canonical string", func(t *testing.T) {
		canonical, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_1DAY, nil, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if canonical != "1d" {
			t.Fatalf("want canonical 1d, got %q", canonical)
		}
	})

	t.Run("range within max_delete_days is accepted", func(t *testing.T) {
		_, start, end, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(0, 0, 5)), 30)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if start.IsZero() || end.IsZero() {
			t.Fatalf("want parsed range, got start=%v end=%v", start, end)
		}
	})

	t.Run("range exceeding max_delete_days is rejected as InvalidArgument", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(0, 0, 30)), 7)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("want InvalidArgument, got %v (err=%v)", connect.CodeOf(err), err)
		}
	})

	t.Run("max_delete_days=0 disables the window guard", func(t *testing.T) {
		_, _, _, err := resolveDeletePlan("AAPL", "4", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, rng(day, day.AddDate(5, 0, 0)), 0)
		if err != nil {
			t.Fatalf("window guard should be off, got %v", err)
		}
	})
}
