package marketsession

import (
	"testing"
	"time"
)

func nyDate(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, ny) }

func utc(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

// Golden vectors: staging marketdata.ohlcv AAPL 1d bar timestamps (query_bars, 2026-10-20).
func TestSessionDate_GoldenStagingBars(t *testing.T) {
	for bar, want := range map[string]time.Time{
		"2026-10-12T04:00:00Z": nyDate(2026, 10, 12), "2026-10-13T04:00:00Z": nyDate(2026, 10, 13),
		"2026-10-14T04:00:00Z": nyDate(2026, 10, 14), "2026-10-15T04:00:00Z": nyDate(2026, 10, 15),
		"2026-10-16T04:00:00Z": nyDate(2026, 10, 16), "2026-10-19T04:00:00Z": nyDate(2026, 10, 19),
		"2026-01-12T05:00:00Z": nyDate(2026, 1, 12), "2026-01-13T05:00:00Z": nyDate(2026, 1, 13),
		"2026-01-14T05:00:00Z": nyDate(2026, 1, 14), "2026-01-15T05:00:00Z": nyDate(2026, 1, 15),
		"2026-01-16T05:00:00Z": nyDate(2026, 1, 16),
		"2025-10-31T04:00:00Z": nyDate(2025, 10, 31), "2025-11-03T05:00:00Z": nyDate(2025, 11, 3),
	} {
		if got := SessionDate(utc(bar)); !got.Equal(want) {
			t.Errorf("SessionDate(%s) = %v, want %v", bar, got, want)
		}
	}
}

func TestReference(t *testing.T) {
	for _, tc := range []struct {
		now  string
		ref  time.Time
		live bool
	}{
		{"2026-10-19T15:00:00Z", nyDate(2026, 10, 19), true},
		{"2026-10-19T21:00:00Z", nyDate(2026, 10, 19), false},
		{"2026-10-17T16:00:00Z", nyDate(2026, 10, 16), false},
		{"2026-10-19T12:00:00Z", nyDate(2026, 10, 16), false},
		{"2026-11-26T16:00:00Z", nyDate(2026, 11, 25), false},
		{"2027-03-26T16:00:00Z", nyDate(2027, 3, 25), false},
	} {
		ref, live := Reference(utc(tc.now))
		if !ref.Equal(tc.ref) || live != tc.live {
			t.Errorf("Reference(%s) = (%v, %v), want (%v, %v)", tc.now, ref, live, tc.ref, tc.live)
		}
	}
}

func TestPrevTradingDay(t *testing.T) {
	for d, want := range map[time.Time]time.Time{
		nyDate(2026, 10, 19): nyDate(2026, 10, 16),
		nyDate(2026, 7, 6):   nyDate(2026, 7, 2),
		nyDate(2027, 12, 27): nyDate(2027, 12, 23),
	} {
		if got := PrevTradingDay(d); !got.Equal(want) {
			t.Errorf("PrevTradingDay(%v) = %v, want %v", d, got, want)
		}
	}
}

func TestHolidays_2026_2028(t *testing.T) {
	want := map[int][]time.Time{
		2026: {nyDate(2026, 1, 1), nyDate(2026, 1, 19), nyDate(2026, 2, 16), nyDate(2026, 4, 3), nyDate(2026, 5, 25),
			nyDate(2026, 6, 19), nyDate(2026, 7, 3), nyDate(2026, 9, 7), nyDate(2026, 11, 26), nyDate(2026, 12, 25)},
		2027: {nyDate(2027, 1, 1), nyDate(2027, 1, 18), nyDate(2027, 2, 15), nyDate(2027, 3, 26), nyDate(2027, 5, 31),
			nyDate(2027, 6, 18), nyDate(2027, 7, 5), nyDate(2027, 9, 6), nyDate(2027, 11, 25), nyDate(2027, 12, 24)},
		2028: {nyDate(2028, 1, 17), nyDate(2028, 2, 21), nyDate(2028, 4, 14), nyDate(2028, 5, 29),
			nyDate(2028, 6, 19), nyDate(2028, 7, 4), nyDate(2028, 9, 4), nyDate(2028, 11, 23), nyDate(2028, 12, 25)},
	}
	for year, days := range want {
		closed := map[time.Time]bool{}
		for _, d := range days {
			closed[d] = true
		}
		for d := nyDate(year, 1, 1); d.Year() == year; d = d.AddDate(0, 0, 1) {
			weekday := d.Weekday() != time.Saturday && d.Weekday() != time.Sunday
			if got, want := IsTradingDay(d), weekday && !closed[d]; got != want {
				t.Errorf("IsTradingDay(%s) = %v, want %v", d.Format("2006-01-02 Mon"), got, want)
			}
		}
	}
	// New Year's on a Saturday has no observance: Fri 2027-12-31 trades.
	if !IsTradingDay(nyDate(2027, 12, 31)) {
		t.Error("2027-12-31 must be a trading day (Sat New Year's is not observed)")
	}
}

func TestDST(t *testing.T) {
	if got := Open(nyDate(2026, 3, 9)); !got.Equal(utc("2026-03-09T13:30:00Z")) {
		t.Errorf("Open(2026-03-09) = %v, want 13:30Z", got.UTC())
	}
	if got := Open(nyDate(2026, 11, 2)); !got.Equal(utc("2026-11-02T14:30:00Z")) {
		t.Errorf("Open(2026-11-02) = %v, want 14:30Z", got.UTC())
	}
	if got := DayStart(nyDate(2026, 11, 2)); !got.Equal(utc("2026-11-02T05:00:00Z")) {
		t.Errorf("DayStart(2026-11-02) = %v, want 05:00Z", got.UTC())
	}
}
