package timeframe

import (
	"testing"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	"github.com/xstockstrat/contracts/marketsession"
)

func TestFromString(t *testing.T) {
	tests := []struct {
		in   string
		want commonv1.Timeframe
	}{
		// The load-bearing bug: "1Day" (analysis) and "1d" (backfill) must agree.
		{"1Day", commonv1.Timeframe_TIMEFRAME_1DAY},
		{"1d", commonv1.Timeframe_TIMEFRAME_1DAY},
		{"15m", commonv1.Timeframe_TIMEFRAME_15MIN},   //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{"15Min", commonv1.Timeframe_TIMEFRAME_15MIN}, //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{"1h", commonv1.Timeframe_TIMEFRAME_1HOUR},    //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{"1Hour", commonv1.Timeframe_TIMEFRAME_1HOUR}, //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		// Sub-15m intervals were removed from the product — no longer resolvable.
		// Load-bearing for feature 080 FR-6/AC-7: streamed bars now WRITE TIMEFRAME_1MIN
		// explicitly (internal/alpaca/stream.go dispatch) without going through FromString —
		// this case is the standing proof that the request-resolution refusal of "1m" stays
		// untouched by that labelling change. Do not delete as redundant.
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

func TestInterval(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
	}{
		{"15m", 15 * time.Minute},
		{"1h", time.Hour},
		{"1d", 24 * time.Hour},
		// Non-canonical / unsupported spellings have no defined interval.
		{"1Day", 0},
		{"1w", 0},
		{"10Min", 0},
		{"", 0},
	}
	for _, tt := range tests {
		if got := Interval(tt.in); got != tt.want {
			t.Errorf("Interval(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestToCanonical(t *testing.T) {
	tests := []struct {
		in     commonv1.Timeframe
		want   string
		wantOk bool
	}{
		{commonv1.Timeframe_TIMEFRAME_15MIN, "15m", true}, //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{commonv1.Timeframe_TIMEFRAME_1HOUR, "1h", true},  //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
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

func nyDay(s string) time.Time {
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return marketsession.DayStart(d.Add(12 * time.Hour))
}

// weekdayStamps lists every weekday (so holidays too) in [from,to] minus exclude; the calendar
// subtest relies on stored non-trading days being ignored.
func weekdayStamps(from, to string, exclude ...string) []time.Time {
	skip := map[string]bool{}
	for _, e := range exclude {
		skip[e] = true
	}
	var out []time.Time
	for d := nyDay(from); !d.After(nyDay(to)); d = d.AddDate(0, 0, 1) {
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday || skip[d.Format("2006-01-02")] {
			continue
		}
		out = append(out, d)
	}
	return out
}

func TestComputeSessionGaps(t *testing.T) {
	now := time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)
	reqStart := time.Date(2025, 11, 20, 0, 0, 0, 0, time.UTC)
	reqEnd := time.Date(2026, 11, 25, 23, 59, 0, 0, time.UTC)
	noon := func(s string) time.Time { return nyDay(s).Add(12 * time.Hour) }
	wantGaps := func(t *testing.T, got []Gap, want ...Gap) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("got %d gaps %+v, want %d %+v", len(got), got, len(want), want)
		}
		for i := range want {
			if !got[i].Start.Equal(want[i].Start) || !got[i].End.Equal(want[i].End) {
				t.Errorf("gap[%d] = [%v, %v], want [%v, %v]", i, got[i].Start, got[i].End, want[i].Start, want[i].End)
			}
		}
	}

	t.Run("AC-1 interior hole", func(t *testing.T) {
		stored := append(weekdayStamps("2025-11-20", "2026-03-31"), weekdayStamps("2026-09-28", "2026-11-25")...)
		wantGaps(t, ComputeSessionGaps(reqStart, reqEnd, stored, now),
			Gap{Start: nyDay("2026-04-01"), End: noon("2026-09-25")})
	})

	t.Run("AC-3 fully covered", func(t *testing.T) {
		if gaps := ComputeSessionGaps(reqStart, reqEnd, weekdayStamps("2025-11-20", "2026-11-25"), now); len(gaps) != 0 {
			t.Errorf("want no gaps, got %+v", gaps)
		}
	})

	t.Run("head and tail", func(t *testing.T) {
		wantGaps(t, ComputeSessionGaps(reqStart, reqEnd, weekdayStamps("2026-01-05", "2026-11-20"), now),
			Gap{Start: nyDay("2025-11-20"), End: noon("2026-01-02")},
			Gap{Start: nyDay("2026-11-23"), End: noon("2026-11-25")})
	})

	t.Run("separation invariant", func(t *testing.T) {
		stored := weekdayStamps("2026-06-01", "2026-07-31",
			"2026-06-05", "2026-06-08", "2026-06-10", "2026-06-18", "2026-06-22", "2026-07-02", "2026-07-06")
		start := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
		end := time.Date(2026, 7, 31, 23, 0, 0, 0, time.UTC)
		gaps := ComputeSessionGaps(start, end, stored, now)
		wantGaps(t, gaps,
			Gap{Start: nyDay("2026-06-05"), End: noon("2026-06-08")},
			Gap{Start: nyDay("2026-06-10"), End: noon("2026-06-10")},
			Gap{Start: nyDay("2026-06-18"), End: noon("2026-06-22")},
			Gap{Start: nyDay("2026-07-02"), End: noon("2026-07-06")})
		for i := 0; i+1 < len(gaps); i++ {
			separated := false
			for _, s := range stored {
				if marketsession.IsTradingDay(s) && s.After(gaps[i].End) && s.Before(gaps[i+1].Start) {
					separated = true
					break
				}
			}
			if !separated {
				t.Errorf("no stored session between gap[%d] %+v and gap[%d] %+v", i, gaps[i], i+1, gaps[i+1])
			}
		}
	})

	t.Run("calendar closures and holidays never missing", func(t *testing.T) {
		stored := weekdayStamps("2024-12-02", "2025-12-31", "2025-01-09", "2025-12-25")
		start := time.Date(2024, 12, 2, 12, 0, 0, 0, time.UTC)
		end := time.Date(2025, 12, 31, 23, 0, 0, 0, time.UTC)
		if gaps := ComputeSessionGaps(start, end, stored, now); len(gaps) != 0 {
			t.Errorf("want no gaps (2025-01-09 closure, 2025-12-25 holiday), got %+v", gaps)
		}
	})

	t.Run("live session not reported", func(t *testing.T) {
		live := time.Date(2026, 11, 25, 15, 0, 0, 0, time.UTC)
		start := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
		if gaps := ComputeSessionGaps(start, reqEnd, weekdayStamps("2026-11-02", "2026-11-24"), live); len(gaps) != 0 {
			t.Errorf("want no gaps while 2026-11-25 is live, got %+v", gaps)
		}
	})

	t.Run("reversed range → nil", func(t *testing.T) {
		if gaps := ComputeSessionGaps(reqEnd, reqStart, nil, now); gaps != nil {
			t.Errorf("want nil, got %+v", gaps)
		}
	})

	t.Run("no bars → first to last session", func(t *testing.T) {
		wantGaps(t, ComputeSessionGaps(reqStart, reqEnd, nil, now),
			Gap{Start: nyDay("2025-11-20"), End: noon("2026-11-25")})
	})
}
