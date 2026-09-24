package repository

import (
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// tifStr maps a TimeInForce enum to its canonical lowercase DB string. The column stays TEXT;
// the Go layer owns validation (same pattern as typeStr for order_type). default→"day" is a
// defensive belt, never reached on write after validateTIF.
func tifStr(t tradingv1.TimeInForce) string {
	switch t {
	case tradingv1.TimeInForce_TIME_IN_FORCE_GTC:
		return "gtc"
	case tradingv1.TimeInForce_TIME_IN_FORCE_IOC:
		return "ioc"
	case tradingv1.TimeInForce_TIME_IN_FORCE_FOK:
		return "fok"
	case tradingv1.TimeInForce_TIME_IN_FORCE_OPG:
		return "opg"
	case tradingv1.TimeInForce_TIME_IN_FORCE_CLS:
		return "cls"
	default:
		return "day"
	}
}

// parseTif maps a canonical DB string back to its TimeInForce enum. Unknown or empty legacy
// strings read back as UNSPECIFIED (FR-4) — mirrors parseType for order_type.
func parseTif(s string) tradingv1.TimeInForce {
	switch s {
	case "day":
		return tradingv1.TimeInForce_TIME_IN_FORCE_DAY
	case "gtc":
		return tradingv1.TimeInForce_TIME_IN_FORCE_GTC
	case "ioc":
		return tradingv1.TimeInForce_TIME_IN_FORCE_IOC
	case "fok":
		return tradingv1.TimeInForce_TIME_IN_FORCE_FOK
	case "opg":
		return tradingv1.TimeInForce_TIME_IN_FORCE_OPG
	case "cls":
		return tradingv1.TimeInForce_TIME_IN_FORCE_CLS
	default:
		return tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED
	}
}
