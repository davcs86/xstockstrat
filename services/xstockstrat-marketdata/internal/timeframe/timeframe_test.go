package timeframe

import (
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

func TestFromString(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.Timeframe
	}{
		// The load-bearing bug: "1Day" (analysis) and "1d" (backfill) must agree.
		{"1Day", commonv1.Timeframe_TIMEFRAME_1DAY},
		{"1d", commonv1.Timeframe_TIMEFRAME_1DAY},
		{"15m", commonv1.Timeframe_TIMEFRAME_15MIN},
		{"15Min", commonv1.Timeframe_TIMEFRAME_15MIN},
		{"1h", commonv1.Timeframe_TIMEFRAME_1HOUR},
		{"1Hour", commonv1.Timeframe_TIMEFRAME_1HOUR},
		// Sub-15m intervals were removed from the product — no longer resolvable.
		{"1m", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED},
		{"5m", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED},
		{"weekly", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED},
		{"", commonv1.Timeframe_TIMEFRAME_UNSPECIFIED},
	}
	for _, tt := range tests {
		if got := FromString(tt.in); got != tt.want {
			t.Errorf("FromString(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestToCanonical(t *testing.T) {
	tests := []struct {
		in     commonv1.Timeframe
		want   string
		wantOk bool
	}{
		{commonv1.Timeframe_TIMEFRAME_15MIN, "15m", true},
		{commonv1.Timeframe_TIMEFRAME_1HOUR, "1h", true},
		{commonv1.Timeframe_TIMEFRAME_1DAY, "1d", true},
		{commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, "", false},
		// Deprecated sub-15m enums no longer map to a canonical string.
		{commonv1.Timeframe_TIMEFRAME_1MIN, "", false}, //nolint:staticcheck // SA1019: asserting the deprecated sub-15m enum no longer resolves
		{commonv1.Timeframe_TIMEFRAME_5MIN, "", false}, //nolint:staticcheck // SA1019: asserting the deprecated sub-15m enum no longer resolves
	}
	for _, tt := range tests {
		got, ok := ToCanonical(tt.in)
		if got != tt.want || ok != tt.wantOk {
			t.Errorf("ToCanonical(%v) = (%q,%v), want (%q,%v)", tt.in, got, ok, tt.want, tt.wantOk)
		}
	}
}

func TestResolve(t *testing.T) {
	// enum preferred
	if got, err := Resolve(commonv1.Timeframe_TIMEFRAME_1DAY, ""); err != nil || got != "1d" {
		t.Errorf("Resolve(enum=1DAY) = (%q,%v), want (1d,nil)", got, err)
	}
	// legacy fallback when enum unspecified
	if got, err := Resolve(commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, "1Day"); err != nil || got != "1d" {
		t.Errorf("Resolve(legacy=1Day) = (%q,%v), want (1d,nil)", got, err)
	}
	// error when neither resolves
	if _, err := Resolve(commonv1.Timeframe_TIMEFRAME_UNSPECIFIED, "nope"); err == nil {
		t.Error("Resolve(unresolvable) expected error, got nil")
	}
}

func TestComputeGaps(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC)

	t.Run("no bars → whole range", func(t *testing.T) {
		gaps := ComputeGaps(start, end, time.Time{}, time.Time{}, 0)
		if len(gaps) != 1 || !gaps[0].Start.Equal(start) || !gaps[0].End.Equal(end) {
			t.Errorf("want one whole-range gap, got %+v", gaps)
		}
	})

	t.Run("leading gap", func(t *testing.T) {
		earliest := time.Date(2024, 1, 3, 0, 0, 0, 0, time.UTC)
		gaps := ComputeGaps(start, end, earliest, end, 5)
		if len(gaps) != 1 || !gaps[0].Start.Equal(start) || !gaps[0].End.Equal(earliest) {
			t.Errorf("want one leading gap, got %+v", gaps)
		}
	})

	t.Run("trailing gap", func(t *testing.T) {
		latest := time.Date(2024, 1, 8, 0, 0, 0, 0, time.UTC)
		gaps := ComputeGaps(start, end, start, latest, 5)
		if len(gaps) != 1 || !gaps[0].Start.Equal(latest) || !gaps[0].End.Equal(end) {
			t.Errorf("want one trailing gap, got %+v", gaps)
		}
	})

	t.Run("fully covered → no gaps", func(t *testing.T) {
		if gaps := ComputeGaps(start, end, start, end, 9); len(gaps) != 0 {
			t.Errorf("want no gaps, got %+v", gaps)
		}
	})

	t.Run("invalid range → nil", func(t *testing.T) {
		if gaps := ComputeGaps(end, start, time.Time{}, time.Time{}, 0); gaps != nil {
			t.Errorf("want nil for end<=start, got %+v", gaps)
		}
	})
}
