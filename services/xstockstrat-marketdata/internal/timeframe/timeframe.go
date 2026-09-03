// Package timeframe maps the common.v1.Timeframe enum and all legacy aliases to the single
// canonical DB bar-interval string ("15m"/"1h"/"1d") and computes coverage gaps. 15m is the smallest
// supported interval; "1m"/"5m" are unresolvable (the WS stream path labels 1m bars directly).
package timeframe

import (
	"fmt"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// ToCanonical maps a Timeframe enum to the canonical DB string. The bool is false for
// TIMEFRAME_UNSPECIFIED / unknown values.
func ToCanonical(tf commonv1.Timeframe) (string, bool) {
	switch tf {
	case commonv1.Timeframe_TIMEFRAME_15MIN: //nolint:staticcheck // SA1019: deprecated for *requests* (feature 143) but still resolved here for the permissive GetDataCoverage/DeleteBackfilledData path on historically-stored 15m rows
		return "15m", true
	case commonv1.Timeframe_TIMEFRAME_1HOUR: //nolint:staticcheck // SA1019: deprecated for *requests* (feature 143) but still resolved here for historically-stored 1h rows
		return "1h", true
	case commonv1.Timeframe_TIMEFRAME_1DAY:
		return "1d", true
	default:
		// TIMEFRAME_UNSPECIFIED and the deprecated TIMEFRAME_1MIN/5MIN
		// (sub-15m intervals are no longer supported) are unresolvable.
		return "", false
	}
}

// Interval returns the wall-clock duration of one bar for a canonical timeframe ("15m"/"1h"/"1d").
// Unknown/unsupported inputs return 0.
func Interval(canonical string) time.Duration {
	switch canonical {
	case "15m":
		return 15 * time.Minute
	case "1h":
		return time.Hour
	case "1d":
		return 24 * time.Hour
	default:
		return 0
	}
}

// FromString maps all known aliases (e.g. "1Day"→canonical) to the enum, reconciling the
// analysis-vs-backfill spelling mismatch. Unrecognized input returns TIMEFRAME_UNSPECIFIED.
func FromString(s string) commonv1.Timeframe {
	switch s {
	case "15m", "15Min":
		return commonv1.Timeframe_TIMEFRAME_15MIN //nolint:staticcheck // SA1019: deprecated for *requests* (feature 143) but still mapped for historically-stored 15m rows on the permissive path
	case "1h", "1Hour":
		return commonv1.Timeframe_TIMEFRAME_1HOUR //nolint:staticcheck // SA1019: deprecated for *requests* (feature 143) but still mapped for historically-stored 1h rows
	case "1d", "1Day":
		return commonv1.Timeframe_TIMEFRAME_1DAY
	default:
		// "1m"/"1Min"/"5m"/"5Min" are intentionally unrecognized — sub-15m
		// intervals were removed from the product.
		return commonv1.Timeframe_TIMEFRAME_UNSPECIFIED
	}
}

// Resolve prefers the enum when set; otherwise falls back to FromString(legacyStr).
// Returns the canonical DB string, or an error if neither resolves.
func Resolve(enum commonv1.Timeframe, legacyStr string) (string, error) {
	if enum != commonv1.Timeframe_TIMEFRAME_UNSPECIFIED {
		if c, ok := ToCanonical(enum); ok {
			return c, nil
		}
	}
	if c, ok := ToCanonical(FromString(legacyStr)); ok {
		return c, nil
	}
	return "", fmt.Errorf("unresolvable timeframe: enum=%v legacy=%q", enum, legacyStr)
}

// Gap is a missing [Start, End] range (pure value type; the service maps it to a proto TimeRange).
type Gap struct {
	Start time.Time
	End   time.Time
}

// ComputeGaps returns the missing ranges in [reqStart,reqEnd] given the covered [earliest,latest]
// span. No bars → whole window; else only leading/trailing segments (interior holes out of scope).
func ComputeGaps(reqStart, reqEnd, earliest, latest time.Time, count int64) []Gap {
	if !reqEnd.After(reqStart) {
		return nil
	}
	if count == 0 {
		return []Gap{{Start: reqStart, End: reqEnd}}
	}
	var gaps []Gap
	if earliest.After(reqStart) {
		gaps = append(gaps, Gap{Start: reqStart, End: earliest})
	}
	if latest.Before(reqEnd) {
		gaps = append(gaps, Gap{Start: latest, End: reqEnd})
	}
	return gaps
}
