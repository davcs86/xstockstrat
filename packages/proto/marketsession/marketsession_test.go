package marketsession

import (
	"testing"
	"time"
)

func TestIsTradingDay_ClosuresAndJuneteenth(t *testing.T) {
	cases := []struct {
		y    int
		m    time.Month
		d    int
		want bool
	}{
		{2001, time.September, 11, false},
		{2001, time.September, 12, false},
		{2001, time.September, 13, false},
		{2001, time.September, 14, false},
		{2004, time.June, 11, false},
		{2007, time.January, 2, false},
		{2012, time.October, 29, false},
		{2012, time.October, 30, false},
		{2018, time.December, 5, false},
		{2025, time.January, 9, false},
		{2022, time.June, 20, false},
		{2021, time.June, 18, true},
		{2025, time.January, 10, true},
		{2025, time.December, 25, false},
	}
	for _, c := range cases {
		day := time.Date(c.y, c.m, c.d, 12, 0, 0, 0, time.UTC)
		if got := IsTradingDay(day); got != c.want {
			t.Errorf("IsTradingDay(%s) = %v, want %v", day.Format("2006-01-02"), got, c.want)
		}
	}
}

func TestPrevTradingDay_SkipsCarterClosure(t *testing.T) {
	got := PrevTradingDay(time.Date(2025, time.January, 10, 12, 0, 0, 0, time.UTC))
	if y, m, d := got.Date(); y != 2025 || m != time.January || d != 8 {
		t.Errorf("PrevTradingDay(2025-01-10) = %s, want 2025-01-08", got.Format("2006-01-02"))
	}
}
