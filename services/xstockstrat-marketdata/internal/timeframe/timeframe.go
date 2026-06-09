// Package timeframe reconciles the OHLCV bar-interval vocabulary across services.
//
// The DB stores literal canonical strings ("1m","5m","1h","1d"). Different callers
// historically sent different spellings — analysis used "1Day" while the backfill path
// used "1d" — so bars written by one were invisible to the other. This package maps
// the shared common.v1.Timeframe enum and all known legacy aliases to the single
// canonical DB string, and computes coverage gaps. It is pure (no DB/gRPC deps) so it
// is unit-testable and counts toward coverage.
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
	case commonv1.Timeframe_TIMEFRAME_1MIN:
		return "1m", true
	case commonv1.Timeframe_TIMEFRAME_5MIN:
		return "5m", true
	case commonv1.Timeframe_TIMEFRAME_1HOUR:
		return "1h", true
	case commonv1.Timeframe_TIMEFRAME_1DAY:
		return "1d", true
	default:
		return "", false
	}
}

// FromString accepts all known aliases for backward compatibility during the deprecation
// cycle. This is what reconciles the "1Day" (analysis) vs "1d" (backfill) mismatch.
// Returns TIMEFRAME_UNSPECIFIED for unrecognized input.
func FromString(s string) commonv1.Timeframe {
	switch s {
	case "1m", "1Min":
		return commonv1.Timeframe_TIMEFRAME_1MIN
	case "5m", "5Min":
		return commonv1.Timeframe_TIMEFRAME_5MIN
	case "1h", "1Hour":
		return commonv1.Timeframe_TIMEFRAME_1HOUR
	case "1d", "1Day":
		return commonv1.Timeframe_TIMEFRAME_1DAY
	default:
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

// ComputeGaps returns the missing ranges within the requested [reqStart, reqEnd] given the
// covered [earliest, latest] span and the stored bar count. Interior-hole detection is out of
// scope for P1 (deferred to P2 resumable-chunked-backfills): when there are no bars the whole
// requested window is a gap; otherwise only the leading [reqStart, earliest) and trailing
// (latest, reqEnd] segments are reported.
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
