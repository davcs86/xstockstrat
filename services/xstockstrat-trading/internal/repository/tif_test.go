package repository

import (
	"testing"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// TestTifStr confirms each enum value maps to its canonical lowercase DB string.
func TestTifStr(t *testing.T) {
	cases := map[tradingv1.TimeInForce]string{
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY: "day",
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC: "gtc",
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC: "ioc",
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK: "fok",
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG: "opg",
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS: "cls",
	}
	for tif, want := range cases {
		if got := tifStr(tif); got != want {
			t.Errorf("tifStr(%v) = %q, want %q", tif, got, want)
		}
	}
}

// TestParseTif_KnownValues confirms the canonical strings round-trip to their enum.
func TestParseTif_KnownValues(t *testing.T) {
	cases := map[string]tradingv1.TimeInForce{
		"day": tradingv1.TimeInForce_TIME_IN_FORCE_DAY,
		"gtc": tradingv1.TimeInForce_TIME_IN_FORCE_GTC,
		"ioc": tradingv1.TimeInForce_TIME_IN_FORCE_IOC,
		"fok": tradingv1.TimeInForce_TIME_IN_FORCE_FOK,
		"opg": tradingv1.TimeInForce_TIME_IN_FORCE_OPG,
		"cls": tradingv1.TimeInForce_TIME_IN_FORCE_CLS,
	}
	for s, want := range cases {
		if got := parseTif(s); got != want {
			t.Errorf("parseTif(%q) = %v, want %v", s, got, want)
		}
	}
}

// TestParseTif_UnknownReturnsUnspecified confirms unmappable legacy strings read back
// as UNSPECIFIED (AC-4).
func TestParseTif_UnknownReturnsUnspecified(t *testing.T) {
	for _, s := range []string{"good_till_cancel", "", "foobar"} {
		if got := parseTif(s); got != tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED {
			t.Errorf("parseTif(%q) = %v, want UNSPECIFIED", s, got)
		}
	}
}
