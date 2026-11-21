// Package marketsession is the NYSE regular-session calendar in America/New_York — a fact of the
// exchange, not config. Early closes and one-off closures are not modelled.
package marketsession

import (
	"time"
	_ "time/tzdata" // the distroless image ships no zoneinfo
)

var ny = mustLoadNY()

func mustLoadNY() *time.Location {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		panic(err)
	}
	return loc
}

// SessionDate maps an instant to its session date (NY midnight). The +6h shift maps a 1d bar stamped
// at 00:00 NY, or a few hours either side of it, to its own date.
func SessionDate(t time.Time) time.Time {
	s := t.Add(6 * time.Hour).In(ny)
	return time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, ny)
}

func nyDay(t time.Time) time.Time {
	n := t.In(ny)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, ny)
}

// DayStart is 00:00 America/New_York of d's date.
func DayStart(d time.Time) time.Time { return nyDay(d) }

// Open is the 09:30 America/New_York regular-session open of d's date.
func Open(d time.Time) time.Time {
	n := d.In(ny)
	return time.Date(n.Year(), n.Month(), n.Day(), 9, 30, 0, 0, ny)
}

func closeAt(d time.Time) time.Time {
	n := d.In(ny)
	return time.Date(n.Year(), n.Month(), n.Day(), 16, 0, 0, 0, ny)
}

// IsTradingDay reports whether d's date is a weekday that is not an NYSE holiday.
func IsTradingDay(d time.Time) bool {
	day := nyDay(d)
	if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
		return false
	}
	return !isHoliday(day)
}

// PrevTradingDay is the latest trading day strictly before d's date.
func PrevTradingDay(d time.Time) time.Time {
	day := nyDay(d).AddDate(0, 0, -1)
	for !IsTradingDay(day) {
		day = day.AddDate(0, 0, -1)
	}
	return day
}

// Reference is the session in progress (live) or, on a weekend, holiday, pre-open or post-close read,
// the most recently completed session.
func Reference(now time.Time) (ref time.Time, live bool) {
	day := nyDay(now)
	if !IsTradingDay(day) || now.Before(Open(day)) {
		return PrevTradingDay(day), false
	}
	return day, now.Before(closeAt(day))
}

func isHoliday(day time.Time) bool {
	y, m, d := day.Year(), day.Month(), day.Day()
	for _, h := range []time.Time{
		newYearsObserved(y),
		nthWeekday(y, time.January, time.Monday, 3),
		nthWeekday(y, time.February, time.Monday, 3),
		easter(y).AddDate(0, 0, -2),
		lastWeekday(y, time.May, time.Monday),
		observed(date(y, time.June, 19)),
		observed(date(y, time.July, 4)),
		nthWeekday(y, time.September, time.Monday, 1),
		nthWeekday(y, time.November, time.Thursday, 4),
		observed(date(y, time.December, 25)),
	} {
		if h.Year() == y && h.Month() == m && h.Day() == d {
			return true
		}
	}
	return false
}

func date(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, ny) }

// observed moves a Saturday holiday to Friday and a Sunday holiday to Monday.
func observed(h time.Time) time.Time {
	switch h.Weekday() {
	case time.Saturday:
		return h.AddDate(0, 0, -1)
	case time.Sunday:
		return h.AddDate(0, 0, 1)
	}
	return h
}

// newYearsObserved: NYSE does not close the prior Friday for a Saturday New Year's Day.
func newYearsObserved(y int) time.Time {
	h := date(y, time.January, 1)
	if h.Weekday() == time.Sunday {
		return h.AddDate(0, 0, 1)
	}
	return h
}

func nthWeekday(y int, m time.Month, wd time.Weekday, n int) time.Time {
	first := date(y, m, 1)
	offset := (int(wd) - int(first.Weekday()) + 7) % 7
	return first.AddDate(0, 0, offset+7*(n-1))
}

func lastWeekday(y int, m time.Month, wd time.Weekday) time.Time {
	last := date(y, m+1, 0)
	return last.AddDate(0, 0, -((int(last.Weekday()) - int(wd) + 7) % 7))
}

// easter is Western Easter Sunday (anonymous Gregorian computus).
func easter(y int) time.Time {
	a, b, c := y%19, y/100, y%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return date(y, time.Month(month), day)
}
