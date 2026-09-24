package service

import (
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// tifToWireString maps a validated TimeInForce enum to the lowercase broker-wire string the
// Alpaca/IBKR adapters consume. UNSPECIFIED maps to "day" as a defense-in-depth belt — it is
// unreachable on any submit path because validateTIF rejects it first. Mirrors orderTypeToIBKR.
func tifToWireString(tif tradingv1.TimeInForce) string {
	switch tif {
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

// allowedTIFs is the per-broker time-in-force support matrix. The set is deployment-time-fixed
// (proto governance: closed enum, not config-driven). Alpaca supports all six; IBKR supports the
// four day/GTC/IOC/FOK (no OPG/CLS auction TIFs); OFFLINE accounts record any TIF as metadata.
var allowedTIFs = map[commonv1.BrokerType]map[tradingv1.TimeInForce]bool{
	commonv1.BrokerType_BROKER_TYPE_ALPACA: {
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS: true,
	},
	commonv1.BrokerType_BROKER_TYPE_IBKR: {
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK: true,
	},
	commonv1.BrokerType_BROKER_TYPE_OFFLINE: {
		tradingv1.TimeInForce_TIME_IN_FORCE_DAY: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_GTC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_IOC: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_FOK: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_OPG: true,
		tradingv1.TimeInForce_TIME_IN_FORCE_CLS: true,
	},
}

// validateTIF rejects an unspecified or per-broker-unsupported time-in-force with InvalidArgument
// before the order can reach a broker. The error names the field and the offending value.
func validateTIF(tif tradingv1.TimeInForce, brokerType commonv1.BrokerType) error {
	if tif == tradingv1.TimeInForce_TIME_IN_FORCE_UNSPECIFIED {
		return grpcstatus.Errorf(codes.InvalidArgument, "time_in_force is required (got %s)", tif)
	}
	if !allowedTIFs[brokerType][tif] {
		return grpcstatus.Errorf(codes.InvalidArgument,
			"time_in_force %s is not supported by broker %s", tif, brokerType)
	}
	return nil
}
